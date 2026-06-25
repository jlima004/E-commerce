import {
  buildSentryCaptureContext,
  scrubBreadcrumb,
  scrubEvent,
  shouldCaptureError,
} from "../../src/observability/sentry-scrub"
import {
  createSentryErrorHandler,
  resolveRequestRouteOrJob,
} from "../../src/api/middlewares"
import defaultMiddlewares from "../../src/api/middlewares"
import {
  applySentryInitialScope,
  createSentryInitOptions,
} from "../../instrumentation"
import type { AppEnv } from "../../src/config/env"
import { MedusaError } from "@medusajs/utils"

const CANARIES = {
  sentryDsn: "https://abc123def456@o123456.ingest.sentry.io/789012",
  postgresUrl: "postgresql://dbuser:dbpass@db.example.com:5432/postgres",
  redisUrl: "redis://:redispass@redis.example.com:6379/0",
  cookie: "session=s3cr3ts3ss10n; Path=/; HttpOnly",
  authorization:
    "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.sig",
  token: "token=super_secret_value",
  stripeSignature: "t=1710000000,v1=abcdef0123456789abcdef0123456789abcdef01",
  webhookPayload:
    "{\"id\":\"evt_123\",\"data\":{\"object\":{\"card\":\"4111111111111111\",\"pix_code\":\"pix_BR1234567890abcdef\"}}}",
  cardNumber: "4111111111111111",
  pixCode: "pix_BR1234567890abcdef",
  email: "customer@example.com",
  phone: "+55 11 99999-9999",
} as const

function expectNoCanaries(value: unknown) {
  const serialized = JSON.stringify(value)

  for (const canary of Object.values(CANARIES)) {
    expect(serialized).not.toContain(canary)
  }
}

describe("sentry scrub", () => {
  it("remove request, user, cookies, auth, URLs, payload bruto e PII desnecessaria do evento", () => {
    const event = scrubEvent({
      event_id: "evt-safe",
      platform: "node",
      environment: "production",
      release: "1.2.3",
      level: "error",
      logger: "app",
      message: `falha ao chamar ${CANARIES.postgresUrl} com ${CANARIES.authorization}`,
      request: {
        url: `https://api.example.com/store/orders?dsn=${encodeURIComponent(CANARIES.sentryDsn)}`,
        headers: {
          authorization: CANARIES.authorization,
          cookie: CANARIES.cookie,
          "stripe-signature": CANARIES.stripeSignature,
        },
        data: CANARIES.webhookPayload,
      },
      user: {
        id: "cus_123",
        email: CANARIES.email,
        ip_address: "203.0.113.45",
      },
      contexts: {
        trace: {
          data: {
            redis_url: CANARIES.redisUrl,
          },
        },
      },
      extra: {
        correlation_id: "corr-123",
        body: CANARIES.webhookPayload,
        token: CANARIES.token,
      },
      tags: {
        service: "@dtc/backend",
        process_role: "worker",
        route_or_job: "/webhooks/stripe/orders/order_01ABCDE12345?secret=1",
        authorization: CANARIES.authorization,
      },
      exception: {
        values: [
          {
            type: "StripeWebhookError",
            value: `assinatura invalida ${CANARIES.stripeSignature}`,
            stacktrace: {
              frames: [
                {
                  filename: `handler.ts?redis=${encodeURIComponent(CANARIES.redisUrl)}`,
                  vars: {
                    authorization: CANARIES.authorization,
                    payload: CANARIES.webhookPayload,
                  },
                },
              ],
            },
          },
        ],
      },
      breadcrumbs: [
        {
          category: "http",
          message: CANARIES.webhookPayload,
          data: {
            url: `https://example.com?token=${CANARIES.token}`,
          },
        },
        {
          category: "app.checkout",
          level: "error",
          message: `falha pix ${CANARIES.pixCode}`,
          data: {
            operation: "checkout.complete",
            route_or_job: "/store/carts/cart_123/complete?email=customer@example.com",
            correlation_id: "corr-123",
            cookie: CANARIES.cookie,
          },
        },
      ],
    })

    expect(event).toEqual({
      event_id: "evt-safe",
      platform: "node",
      environment: "production",
      release: "1.2.3",
      level: "error",
      logger: "app",
      message: expect.any(String),
      extra: {
        correlation_id: "corr-123",
      },
      tags: {
        service: "@dtc/backend",
        process_role: "worker",
        route_or_job: "/webhooks/stripe/orders/:id",
      },
      exception: {
        values: [
          {
            type: "StripeWebhookError",
            value: expect.any(String),
            stacktrace: {
              frames: [
                {
                  filename: expect.any(String),
                },
              ],
            },
          },
        ],
      },
      breadcrumbs: [
        {
          category: "app.checkout",
          level: "error",
          message: expect.any(String),
          data: {
            operation: "checkout.complete",
            route_or_job: "/store/carts/:id/complete",
            correlation_id: "corr-123",
          },
        },
      ],
    })
    expectNoCanaries(event)
  })

  it("descarta breadcrumbs de rede e saneia breadcrumbs operacionais", () => {
    expect(
      scrubBreadcrumb({
        category: "fetch",
        message: `POST ${CANARIES.postgresUrl}`,
      })
    ).toBeNull()

    const breadcrumb = scrubBreadcrumb({
      category: "app.worker",
      level: "warn",
      type: "default",
      message: `token ${CANARIES.token}`,
      data: {
        operation: "fulfillment.submit",
        integration: "gelato",
        route_or_job: "/admin/orders/order_01ABCDE/refunds?email=customer@example.com",
        correlation_id: "corr-456",
        authorization: CANARIES.authorization,
      },
    })

    expect(breadcrumb).toEqual({
      category: "app.worker",
      level: "warn",
      type: "default",
      message: expect.any(String),
      data: {
        operation: "fulfillment.submit",
        integration: "gelato",
        route_or_job: "/admin/orders/:id/refunds",
        correlation_id: "corr-456",
      },
    })
    expectNoCanaries(breadcrumb)
  })
})

describe("capture policy", () => {
  it("nao captura warn esperado por padrao", () => {
    expect(
      shouldCaptureError({
        level: "warn",
        expected: true,
      })
    ).toBe(false)
  })

  it("captura erro inesperado e warn persistente nao esperado", () => {
    expect(
      shouldCaptureError({
        level: "error",
        expected: false,
      })
    ).toBe(true)

    expect(
      shouldCaptureError({
        level: "warn",
        expected: false,
        persistent: true,
      })
    ).toBe(true)
  })

  it("reutiliza a chave de agrupamento do logger sem cardinalidade por IDs crus", () => {
    const captureA = buildSentryCaptureContext({
      errorClass: "StripeWebhookError",
      operation: "webhook.verify",
      integration: "stripe",
      routeOrJob: "/webhooks/stripe/order_01HABCDE12345",
      correlationId: "corr-a",
      processRole: "worker",
    })
    const captureB = buildSentryCaptureContext({
      errorClass: "StripeWebhookError",
      operation: "webhook.verify",
      integration: "stripe",
      routeOrJob: "/webhooks/stripe/order_01HZZZZZ98765",
      correlationId: "corr-b",
      processRole: "worker",
    })
    const captureC = buildSentryCaptureContext({
      errorClass: "GelatoError",
      operation: "fulfillment.submit",
      integration: "gelato",
      routeOrJob: "/admin/orders/order_01HABCDE12345",
      correlationId: "corr-c",
      processRole: "worker",
    })

    expect(captureA.fingerprint).toEqual(captureB.fingerprint)
    expect(captureA.groupingKey).toBe(captureB.groupingKey)
    expect(captureA.groupingKey).not.toContain("order_01")
    expect(captureA.tags.route_or_job).toBe("/webhooks/stripe/:id")
    expect(captureA.tags.process_role).toBe("worker")
    expect(captureA.extra).toEqual({ correlation_id: "corr-a" })
    expect(captureA.fingerprint).not.toEqual(captureC.fingerprint)
  })
})

function createEnvFixture(
  overrides: Partial<AppEnv> = {}
): AppEnv {
  return {
    NODE_ENV: "development",
    DATABASE_URL: undefined,
    DATABASE_MIGRATION_URL: undefined,
    API_PUBLIC_URL: undefined,
    STORE_CORS: "http://localhost:8000",
    ADMIN_CORS: "http://localhost:9000",
    AUTH_CORS: "http://localhost:9000",
    REDIS_URL: undefined,
    CACHE_REDIS_URL: undefined,
    EVENTS_REDIS_URL: undefined,
    WE_REDIS_URL: undefined,
    JWT_SECRET: "supersecret",
    COOKIE_SECRET: "supersecret",
    SENTRY_DSN: undefined,
    APP_VERSION: "dev",
    WORKER_MODE: "shared",
    ADMIN_DISABLED: false,
    ...overrides,
  }
}

describe("instrumentation", () => {
  it("inicializa o SDK com hooks de scrubbing, contexto minimo e sendDefaultPii=false", () => {
    const options = createSentryInitOptions(
      createEnvFixture({
        NODE_ENV: "production",
        SENTRY_DSN: "https://public@example.ingest.sentry.io/123",
        APP_VERSION: "2026.06.25+abc1234",
        WORKER_MODE: "worker",
      })
    )

    expect(options.dsn).toBe("https://public@example.ingest.sentry.io/123")
    expect(options.enabled).toBe(true)
    expect(options.environment).toBe("production")
    expect(options.release).toBe("2026.06.25+abc1234")
    expect(options.sendDefaultPii).toBe(false)
    expect(options.tracesSampleRate).toBe(0)

    const scope = {
      setTag: jest.fn(),
    }

    options.initialScope?.(scope as never)

    expect(scope.setTag).toHaveBeenCalledWith("service", "@dtc/backend")
    expect(scope.setTag).toHaveBeenCalledWith("process_role", "worker")

    const scrubbedEvent = options.beforeSend?.({
      message: `falha ${CANARIES.authorization}`,
      request: { headers: { authorization: CANARIES.authorization } },
    } as never)

    expect(scrubbedEvent).toEqual({
      message: expect.any(String),
    })
    expectNoCanaries(scrubbedEvent)

    const scrubbedBreadcrumb = options.beforeBreadcrumb?.({
      category: "app.checkout",
      message: `falha ${CANARIES.token}`,
      data: {
        route_or_job: "/store/carts/cart_123/complete",
        correlation_id: "corr-123",
      },
    } as never)

    expect(scrubbedBreadcrumb).toEqual({
      category: "app.checkout",
      message: expect.any(String),
      data: {
        route_or_job: "/store/carts/:id/complete",
        correlation_id: "corr-123",
      },
    })
    expectNoCanaries(scrubbedBreadcrumb)
  })

  it("desabilita o SDK local sem DSN para nao tentar rede", () => {
    const options = createSentryInitOptions(
      createEnvFixture({
        NODE_ENV: "development",
        SENTRY_DSN: undefined,
        APP_VERSION: "dev",
      })
    )

    expect(options.enabled).toBe(false)
    expect(options.dsn).toBeUndefined()
  })

  it("aplica apenas tags seguras no escopo inicial", () => {
    const scope = {
      setTag: jest.fn(),
    }

    applySentryInitialScope(scope, createEnvFixture({ WORKER_MODE: "server" }))

    expect(scope.setTag).toHaveBeenCalledTimes(2)
    expect(scope.setTag).toHaveBeenNthCalledWith(1, "service", "@dtc/backend")
    expect(scope.setTag).toHaveBeenNthCalledWith(2, "process_role", "server")
  })
})

describe("error handler", () => {
  function createMockResponse() {
    return {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    } as unknown as MedusaResponse
  }

  it("captura uma unica vez erro inesperado e preserva a resposta do handler Medusa", () => {
    const captureException = jest.fn(() => "event-id")
    const medusaErrorHandler = jest.fn((_error, _req, res: MedusaResponse) => {
      res.status(500)
      res.json({ code: "unknown_error" })
    })
    const handler = createSentryErrorHandler({
      captureException,
      medusaErrorHandler,
      processRole: "worker",
    })
    const req = {
      method: "POST",
      route: { path: "/store/orders/order_01HABCDE12345/cancel" },
      headers: {},
      correlationId: "corr-123",
    } as unknown as MedusaRequest
    const res = createMockResponse()
    const next = jest.fn()
    const error = Object.assign(new Error(`boom ${CANARIES.authorization}`), {
      name: "StripeWebhookError",
      operation: "webhook.verify",
      integration: "stripe",
    })

    handler(error, req, res, next)

    expect(captureException).toHaveBeenCalledTimes(1)
    expect(captureException).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "StripeWebhookError",
      }),
      expect.objectContaining({
        fingerprint: ["stripewebhookerror|webhook.verify|stripe|/store/orders/:id/cancel"],
        tags: expect.objectContaining({
          process_role: "worker",
          route_or_job: "/store/orders/:id/cancel",
          operation: "webhook.verify",
          integration: "stripe",
        }),
        extra: {
          correlation_id: "corr-123",
        },
      })
    )
    expect(medusaErrorHandler).toHaveBeenCalledTimes(1)
    expect((res.status as jest.Mock).mock.calls[0]?.[0]).toBe(500)
    expect((res.json as jest.Mock).mock.calls[0]?.[0]).toEqual({
      code: "unknown_error",
    })
  })

  it("nao captura warn esperado por padrao, mas permite warn persistente", () => {
    const captureException = jest.fn(() => "event-id")
    const medusaErrorHandler = jest.fn()
    const handler = createSentryErrorHandler({
      captureException,
      medusaErrorHandler,
      processRole: "server",
    })
    const req = {
      method: "POST",
      route: { path: "/webhooks/stripe/order_01HABCDE12345" },
      headers: {},
    } as unknown as MedusaRequest
    const res = createMockResponse()
    const next = jest.fn()
    const expectedWarn = new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "assinatura invalida"
    )
    const persistentWarn = Object.assign(
      new MedusaError(MedusaError.Types.INVALID_DATA, "falha repetida"),
      {
        persistent: true,
        operation: "webhook.verify",
        integration: "stripe",
      }
    )

    handler(expectedWarn, req, res, next)
    expect(captureException).not.toHaveBeenCalled()

    handler(persistentWarn, req, res, next)
    expect(captureException).toHaveBeenCalledTimes(1)
    expect(captureException).toHaveBeenCalledWith(
      expect.objectContaining({
        type: MedusaError.Types.INVALID_DATA,
      }),
      expect.objectContaining({
        fingerprint: ["invalid_data|webhook.verify|stripe|/webhooks/stripe/:id"],
      })
    )
  })
})

describe("middleware wiring", () => {
  it("mantem o middleware de correlacao e adiciona errorHandler Sentry sem sobrescrever rotas", () => {
    expect(defaultMiddlewares.routes).toHaveLength(1)
    expect(defaultMiddlewares.routes?.[0]?.middlewares).toHaveLength(1)
    expect(typeof defaultMiddlewares.routes?.[0]?.middlewares?.[0]).toBe("function")
    expect(typeof defaultMiddlewares.errorHandler).toBe("function")
  })

  it("normaliza a rota do request para fingerprint sem IDs crus", () => {
    const route = resolveRequestRouteOrJob({
      method: "GET",
      route: { path: "/admin/orders/order_01HABCDE12345/refunds" },
      headers: {},
    } as MedusaRequest)

    expect(route).toBe("/admin/orders/:id/refunds")
  })
})
