import fs from "fs"
import path from "path"
import { MedusaError } from "@medusajs/framework/utils"
import { toStoreErrorResponse } from "../errors"
import { sanitizeContext, sanitizeError } from "../../../observability/sanitize"
import { scrubEvent } from "../../../observability/sentry-scrub"
import { sanitizeStoreIdempotencySafeMetadata } from "../../../modules/store-idempotency"
import { sanitizeCheckoutCompletionMetadata } from "../../../modules/checkout-completion/service"

const CANARIES = {
  idempotencyKey: "idem_raw_13_07_never_persist",
  pepper: "sk_test_phase13pepper",
  jwt: "eyJhbGciOiJIUzI1NiJ9.c3ludGhldGlj.sig",
  guestCapability: "guest_capability_13_07_raw",
  confirmation: "confirmation_token_13_07_raw",
  cpf: "529.982.247-25",
  clientSecret: "pi_SYNTHETIC1307",
  pixQr: "pix_SYNTHETIC1307",
  pixCopyPaste: "00020126130000SYNTHETICPIX1307",
  providerId: "provider_internal_13_07",
  providerPayload: "provider_payload_13_07_raw",
  stack: "password=stackPhase13SecurityNegativeRaw",
  internalError: "secret=internalErrorPhase13Raw",
} as const

function expectNoCanaries(value: unknown): void {
  const serialized = JSON.stringify(value)
  for (const canary of Object.values(CANARIES)) {
    expect(serialized).not.toContain(canary)
  }
}

describe("Phase 13 final sensitive cross-sink negatives", () => {
  it("sanitizes Store HTTP responses without request echo or unsafe field errors", () => {
    const result = toStoreErrorResponse(
      new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `${CANARIES.internalError} ${CANARIES.clientSecret}`
      ),
      {
        correlationId: `${CANARIES.confirmation}\ninvalid`,
        fieldErrors: {
          email: CANARIES.cpf,
          password: CANARIES.jwt,
          postal_code: CANARIES.pixCopyPaste,
        },
        cart: { provider_payload: CANARIES.providerPayload },
      }
    )

    expect(result.body.code).toBe("VALIDATION_ERROR")
    expect(result.body.retryable).toBe(false)
    expect(result.body).not.toHaveProperty("cart")
    expect(result.body).not.toHaveProperty("request")
    expectNoCanaries(result.body)
  })

  it("removes sensitive structured-log values and redacts error chains", () => {
    const error = new Error(
      `${CANARIES.internalError} Bearer ${CANARIES.jwt} ${CANARIES.clientSecret}`
    )
    error.stack = `${CANARIES.stack} Bearer ${CANARIES.jwt}`
    const output = sanitizeContext({
      operation: "phase13.security-negative",
      body: CANARIES.providerPayload,
      headers: CANARIES.idempotencyKey,
      cpf: CANARIES.cpf,
      token: CANARIES.confirmation,
      error_chain: error,
    })

    expect(output).not.toHaveProperty("body")
    expect(output).not.toHaveProperty("headers")
    expect(output).not.toHaveProperty("cpf")
    expect(output).not.toHaveProperty("token")
    expectNoCanaries(output)
    expectNoCanaries(sanitizeError(error))
  })

  it("scrubs Sentry request/context and sensitive exception material", () => {
    const scrubbed = scrubEvent({
      message: `${CANARIES.clientSecret} Bearer ${CANARIES.jwt}`,
      request: { body: CANARIES.providerPayload },
      user: { cpf: CANARIES.cpf },
      contexts: { provider: CANARIES.providerId },
      extra: {
        correlation_id: `Bearer ${CANARIES.jwt}`,
        provider_payload: CANARIES.providerPayload,
      },
      exception: {
        values: [
          {
            value: `${CANARIES.pixQr} ${CANARIES.clientSecret}`,
            stacktrace: {
              frames: [
                {
                  vars: `${CANARIES.stack} ${CANARIES.pixCopyPaste}`,
                },
              ],
            },
          },
        ],
      },
      breadcrumbs: [
        {
          category: "http.request",
          message: CANARIES.providerPayload,
          data: { confirmation: CANARIES.confirmation },
        },
      ],
    })

    expect(scrubbed).not.toHaveProperty("request")
    expect(scrubbed).not.toHaveProperty("user")
    expect(scrubbed).not.toHaveProperty("contexts")
    expectNoCanaries(scrubbed)
  })

  it("rejects sensitive DB-visible metadata instead of persisting a canary", () => {
    const forbiddenValues = [
      CANARIES.idempotencyKey,
      CANARIES.pepper,
      CANARIES.jwt,
      CANARIES.guestCapability,
      CANARIES.confirmation,
      CANARIES.cpf,
      CANARIES.clientSecret,
      CANARIES.pixQr,
      CANARIES.pixCopyPaste,
      CANARIES.providerId,
      CANARIES.providerPayload,
      CANARIES.stack,
      CANARIES.internalError,
    ]

    for (const value of forbiddenValues) {
      expect(() =>
        sanitizeStoreIdempotencySafeMetadata({ raw_idempotency_key: value })
      ).toThrow()
    }
    const checkoutMetadata = sanitizeCheckoutCompletionMetadata({
      raw_payload: CANARIES.providerPayload,
    })
    expect(checkoutMetadata).toBeNull()
    expectNoCanaries(checkoutMetadata)
  })

  it("keeps committed OpenAPI examples, fixtures and snapshots canary-free", () => {
    const backendRoot = path.resolve(__dirname, "../../../..")
    const roots = [
      path.join(backendRoot, "src/api-docs/generated"),
      path.join(backendRoot, "src/api-docs/__fixtures__"),
      path.join(backendRoot, "src/api-docs/__snapshots__"),
    ]
    const files: string[] = []

    const walk = (root: string) => {
      if (!fs.existsSync(root)) return
      for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        const full = path.join(root, entry.name)
        if (entry.isDirectory()) walk(full)
        else files.push(full)
      }
    }
    roots.forEach(walk)

    expect(files.some((file) => file.endsWith("store.openapi.json"))).toBe(true)
    for (const file of files) {
      expectNoCanaries(fs.readFileSync(file, "utf8"))
    }
  })
})
