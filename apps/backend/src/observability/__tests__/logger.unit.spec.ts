import { EventEmitter } from "events"
import { Writable } from "stream"
import type { MedusaNextFunction, MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { createCorrelationAndAccessLogMiddleware } from "../../api/middlewares"
import {
  buildErrorGroupingKey,
  createLogger,
  normalizeRouteOrJob,
} from "../logger"
import { createMedusaLogger } from "../medusa-logger"
import { REDACTED, sanitizeError } from "../sanitize"

const CANARIES = {
  stripeSecret: ["sk", "live", "canaryvalue"].join("_"),
  webhookSecret: "whsec_test_canary_value_12345",
  pan: "4111111111111111",
  bearer: "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.sig",
} as const

function captureLoggerLines(environment: "production" | "local" = "production") {
  const lines: string[] = []
  const destination = new Writable({
    write(chunk, _encoding, callback) {
      lines.push(chunk.toString())
      callback()
    },
  })

  const logger = createLogger({ environment, destination })
  return { logger, lines }
}

function expectNoCanariesInLines(lines: string[]) {
  const serialized = lines.join("\n")

  for (const canary of Object.values(CANARIES)) {
    expect(serialized).not.toContain(canary)
  }
}

describe("normalizeRouteOrJob", () => {
  it("normalizes UUID, Medusa IDs, and numeric segments for grouping cardinality", () => {
    const routeA = normalizeRouteOrJob(
      "/store/orders/order_01JABCDEF123456789/order_01JXYZ987654321"
    )
    const routeB = normalizeRouteOrJob(
      "/store/orders/order_01JZZZZZZZZZZZZZZZ/order_01JYYYYYYYYYYYYYY"
    )

    expect(routeA).toBe("/store/orders/:id/:id")
    expect(routeB).toBe(routeA)
  })

  it("strips query strings from routes", () => {
    expect(
      normalizeRouteOrJob(
        `/store/products?secret=${["sk", "live", "ignored"].join("_")}&email=test@example.com`
      )
    ).toBe("/store/products")
  })
})

describe("buildErrorGroupingKey", () => {
  it("groups different IDs on the same route template", () => {
    const keyA = buildErrorGroupingKey({
      errorClass: "StripeError",
      operation: "payment.capture",
      integration: "stripe",
      routeOrJob: "/webhooks/stripe/order_01AAAA",
    })
    const keyB = buildErrorGroupingKey({
      errorClass: "StripeError",
      operation: "payment.capture",
      integration: "stripe",
      routeOrJob: "/webhooks/stripe/order_01BBBB",
    })

    expect(keyA).toBe(keyB)
    expect(keyA).not.toContain("order_01")
  })

  it("separates groups by class and operation", () => {
    const base = {
      integration: "stripe",
      routeOrJob: "/store/checkout",
    }

    const payment = buildErrorGroupingKey({
      ...base,
      errorClass: "PaymentError",
      operation: "payment.capture",
    })
    const webhook = buildErrorGroupingKey({
      ...base,
      errorClass: "WebhookError",
      operation: "webhook.verify",
    })

    expect(payment).not.toBe(webhook)
  })
})

describe("Pino output", () => {
  it("emits parseable JSON in production with service and correlation_id", () => {
    const { logger, lines } = captureLoggerLines("production")

    logger.info({
      correlation_id: "corr-abc-123",
      operation: "test.event",
      message: "hello",
    })

    expect(lines).toHaveLength(1)
    const parsed = JSON.parse(lines[0]!)
    expect(parsed.level).toBeDefined()
    expect(parsed.time).toBeDefined()
    expect(parsed.service).toBe("@dtc/backend")
    expect(parsed.correlation_id).toBe("corr-abc-123")
  })

  it("redacts canaries from captured production output", () => {
    const { logger, lines } = captureLoggerLines("production")

    logger.warn({
      operation: "test.redaction",
      message: `failed ${CANARIES.stripeSecret} ${CANARIES.webhookSecret} ${CANARIES.pan} ${CANARIES.bearer}`,
    })

    expectNoCanariesInLines(lines)
    expect(lines.join("\n")).toContain(REDACTED)
  })

  it("does not open log files", () => {
    const fs = require("fs")
    const openSpy = jest.spyOn(fs, "createWriteStream").mockImplementation(() => {
      throw new Error("file logging is forbidden")
    })

    expect(() => {
      const { logger } = captureLoggerLines("production")
      logger.info({ operation: "test.file_guard", message: "ok" })
    }).not.toThrow()

    openSpy.mockRestore()
  })
})

describe("levels and grouping", () => {
  it("preserves info, warn, and error semantics", () => {
    const { logger, lines } = captureLoggerLines("production")

    logger.info({ operation: "test.info", message: "info-event" })
    logger.warn({ operation: "test.warn", message: "warn-event" })
    logger.error({ operation: "test.error", message: "error-event" })

    const parsed = lines.map((line) => JSON.parse(line))
    expect(parsed[0]?.level).toBe(30)
    expect(parsed[1]?.level).toBe(40)
    expect(parsed[2]?.level).toBe(50)
  })

  it("keeps grouping_key deterministic without raw IDs", () => {
    const { logger, lines } = captureLoggerLines("production")

    logger.error({
      operation: "payment.capture",
      error_class: "StripeError",
      grouping_key: buildErrorGroupingKey({
        errorClass: "StripeError",
        operation: "payment.capture",
        integration: "stripe",
        routeOrJob: "/store/orders/order_01HABCDEF",
      }),
    })

    const parsed = JSON.parse(lines[0]!)
    expect(parsed.grouping_key).toContain("/store/orders/:id")
    expect(parsed.grouping_key).not.toContain("order_01")
  })
})

describe("adapter", () => {
  it("emits a single sanitized event per adapter call", () => {
    const { logger, lines } = captureLoggerLines("production")
    const adapter = createMedusaLogger(logger)

    adapter.info("boot complete")

    expect(lines).toHaveLength(1)
    const parsed = JSON.parse(lines[0]!)
    expect(parsed.operation).toBe("logger.info")
    expect(parsed.message).toBe("boot complete")
  })

  it("preserves sanitized error causes in production output", () => {
    const { logger, lines } = captureLoggerLines("production")
    const root = new Error(`root ${CANARIES.webhookSecret}`)
    const top = new Error(`top ${CANARIES.stripeSecret}`)
    ;(top as Error & { cause?: Error }).cause = root

    logger.error({
      operation: "test.error",
      error_chain: sanitizeError(top),
    })

    const parsed = JSON.parse(lines[0]!)
    expect(parsed.error_chain.cause?.message).toContain(REDACTED)
  })

  it("logs errors once with sanitized cause chain", () => {
    const { logger, lines } = captureLoggerLines("production")
    const adapter = createMedusaLogger(logger)
    const root = new Error(`root ${CANARIES.webhookSecret}`)
    const top = new Error(`top ${CANARIES.stripeSecret}`)
    ;(top as Error & { cause?: Error }).cause = root

    adapter.error(top)

    expect(lines).toHaveLength(1)
    expectNoCanariesInLines(lines)
    const parsed = JSON.parse(lines[0]!)
    expect(parsed.error_chain.message).toContain(REDACTED)
    expect(parsed.error_chain.cause?.message).toContain(REDACTED)
    expect(parsed.grouping_key).toBeDefined()
  })
})

describe("correlation and access log middleware", () => {
  function createMockResponse() {
    const emitter = new EventEmitter()
    return Object.assign(emitter, {
      statusCode: 200,
      setHeader: jest.fn(),
    }) as unknown as MedusaResponse & EventEmitter
  }

  function withCapturedChildLogger() {
    const captured = captureLoggerLines("production")
    const middleware = createCorrelationAndAccessLogMiddleware({
      createChildLogger: (context) => captured.logger.child(context),
    })
    return { ...captured, middleware }
  }

  function runCapturedMiddleware(
    middleware: ReturnType<typeof createCorrelationAndAccessLogMiddleware>,
    req: Partial<MedusaRequest>,
    res: MedusaResponse & EventEmitter
  ) {
    const next = jest.fn() as MedusaNextFunction
    middleware(req as MedusaRequest, res, next)
    return next
  }

  it("propagates a valid correlation ID header", () => {
    const { lines, middleware } = withCapturedChildLogger()
    const req = {
      method: "GET",
      headers: { "x-correlation-id": "corr-valid-001" },
      originalUrl: "/store/products",
      url: "/store/products",
      path: "/store/products",
      baseUrl: "",
    } as unknown as MedusaRequest
    const res = createMockResponse()

    runCapturedMiddleware(middleware, req, res)
    res.statusCode = 200
    res.emit("finish")

    expect(res.setHeader).toHaveBeenCalledWith(
      "x-correlation-id",
      "corr-valid-001"
    )
    expect(lines).toHaveLength(1)
    const parsed = JSON.parse(lines[0]!)
    expect(parsed.correlation_id).toBe("corr-valid-001")
    expect(parsed.method).toBe("GET")
    expect(parsed.route).toBe("/store/products")
    expect(parsed.status).toBe(200)
    expect(parsed.duration_ms).toBeGreaterThanOrEqual(0)
  })

  it("replaces invalid correlation IDs with a generated UUID header", () => {
    const { middleware } = withCapturedChildLogger()
    const req = {
      method: "POST",
      headers: { "x-correlation-id": "bad id with spaces!" },
      originalUrl: "/store/carts",
      url: "/store/carts",
      path: "/store/carts",
      baseUrl: "",
    } as unknown as MedusaRequest
    const res = createMockResponse()

    runCapturedMiddleware(middleware, req, res)

    const headerValue = (res.setHeader as jest.Mock).mock.calls[0]?.[1]
    expect(headerValue).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    )
  })

  it("does not log body or query values from the request", () => {
    const { lines, middleware } = withCapturedChildLogger()
    const req = {
      method: "POST",
      headers: {
        authorization: CANARIES.bearer,
        cookie: "session=secret",
      },
      body: { card: CANARIES.pan },
      query: { token: CANARIES.stripeSecret },
      originalUrl: `/store/checkout?token=${CANARIES.stripeSecret}`,
      url: `/store/checkout?token=${CANARIES.stripeSecret}`,
      path: "/store/checkout",
      baseUrl: "",
      route: { path: "/store/checkout/:id" },
    } as unknown as MedusaRequest
    const res = createMockResponse()

    runCapturedMiddleware(middleware, req, res)
    res.emit("finish")

    expectNoCanariesInLines(lines)
    const parsed = JSON.parse(lines[0]!)
    expect(parsed.route).toBe("/store/checkout/:id")
    expect(parsed.body).toBeUndefined()
    expect(parsed.query).toBeUndefined()
    expect(parsed.headers).toBeUndefined()
  })

  it("skips successful health checks but keeps failure warnings", () => {
    const { lines: successLines, middleware: successMiddleware } =
      withCapturedChildLogger()
    const successReq = {
      method: "GET",
      headers: {},
      originalUrl: "/health/live",
      url: "/health/live",
      path: "/health/live",
      baseUrl: "",
    } as unknown as MedusaRequest
    const successRes = createMockResponse()

    runCapturedMiddleware(successMiddleware, successReq, successRes)
    successRes.statusCode = 200
    successRes.emit("finish")
    expect(successLines).toHaveLength(0)

    const { lines: failureLines, middleware: failureMiddleware } =
      withCapturedChildLogger()
    const failureReq = {
      method: "GET",
      headers: {},
      originalUrl: "/health/ready",
      url: "/health/ready",
      path: "/health/ready",
      baseUrl: "",
    } as unknown as MedusaRequest
    const failureRes = createMockResponse()

    runCapturedMiddleware(failureMiddleware, failureReq, failureRes)
    failureRes.statusCode = 503
    failureRes.emit("finish")
    expect(failureLines).toHaveLength(1)
    expect(JSON.parse(failureLines[0]!).status).toBe(503)
  })
})
