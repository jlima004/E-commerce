import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import defaultMiddlewares from "../../src/api/middlewares"
import { PAYMENT_ATTEMPT_MODULE } from "../../src/modules/payment-attempt"
import type { PaymentAttemptRecord } from "../../src/modules/payment-attempt/types"
import { WEBHOOKS_MODULE } from "../../src/modules/webhooks"
import { createStripeWebhookPostHandler } from "../../src/api/hooks/stripe/route"

type RequestWithRawBody = MedusaRequest & {
  rawBody?: Buffer | string
  correlationId?: string
}

type StoredWebhookRecord = {
  id: string
  provider: string
  external_event_id: string | null
  deduplication_key: string
  event_type: string
  status: string
  entity_type?: string
  entity_id?: string | null
  error_code?: string | null
  error_message?: string | null
  processed_at?: string | null
  failed_at?: string | null
  ignored_at?: string | null
  metadata?: Record<string, unknown> | null
}

const FORBIDDEN_STRINGS = [
  "completeCartWorkflow",
  "createOrderWorkflow",
  "CheckoutCompletionLog",
  "purchase_completed",
  "order.gelatoapis.com",
  "gelato_order_id",
] as const

function buildAttempt(
  overrides: Partial<PaymentAttemptRecord> = {}
): PaymentAttemptRecord {
  return {
    id: "payatt_http_01",
    cart_id: "cart_http_01",
    payment_collection_id: "paycol_http_01",
    payment_session_id: "payses_http_01",
    provider: "stripe",
    provider_payment_intent_id: "pi_http_123",
    provider_payment_session_id: "ps_http_123",
    payment_method_type: "card",
    status: "awaiting_webhook_confirmation",
    amount: 9900,
    currency_code: "brl",
    expires_at: null,
    order_id: null,
    metadata: { cart_resource_version: 1 },
    client_confirmed_at: null,
    instructions_displayed_at: null,
    awaiting_webhook_since: "2026-06-30T10:00:00.000Z",
    superseded_at: null,
    invalidated_at: null,
    canceled_at: null,
    failed_at: null,
    expired_at: null,
    created_at: "2026-06-30T09:00:00.000Z",
    updated_at: "2026-06-30T09:00:00.000Z",
    ...overrides,
  }
}

function createResponse() {
  const response = {
    statusCode: 200,
    status: jest.fn(function status(code: number) {
      response.statusCode = code
      return response
    }),
    json: jest.fn(function json(body: unknown) {
      return body
    }),
  }

  return response as MedusaResponse & {
    statusCode: number
    status: jest.Mock
    json: jest.Mock
  }
}

function createStatefulWebhookService(records: StoredWebhookRecord[] = []) {
  return {
    listWebhookEventLogs: jest.fn(async (filters?: Record<string, unknown>) => {
      return records.filter((record) => {
        return (
          (!filters?.provider || record.provider === filters.provider) &&
          (!filters?.deduplication_key ||
            record.deduplication_key === filters.deduplication_key)
        )
      })
    }),
    createWebhookEventLogs: jest.fn(async (input) => {
      const row = Array.isArray(input) ? input[0] : input
      const duplicate = records.find(
        (record) =>
          record.provider === row.provider &&
          record.deduplication_key === row.deduplication_key
      )

      if (duplicate) {
        throw new Error("duplicate key value violates unique constraint")
      }

      const created: StoredWebhookRecord = {
        id: `whlog_${records.length + 1}`,
        provider: row.provider,
        external_event_id: row.external_event_id ?? null,
        deduplication_key: row.deduplication_key,
        event_type: row.event_type,
        status: row.status ?? "received",
        entity_type: row.entity_type ?? "unknown",
        entity_id: row.entity_id ?? null,
        error_code: row.error_code ?? null,
        error_message: row.error_message ?? null,
        processed_at: row.processed_at ?? null,
        failed_at: row.failed_at ?? null,
        ignored_at: row.ignored_at ?? null,
        metadata: row.metadata ?? null,
      }
      records.push(created)
      return [created]
    }),
    updateWebhookEventLogs: jest.fn(async (input) => {
      const row = Array.isArray(input) ? input[0] : input
      const index = records.findIndex((record) => record.id === row.id)
      if (index < 0) {
        throw new Error("webhook record not found")
      }

      records[index] = {
        ...records[index],
        ...row,
      }

      return [records[index]]
    }),
    records,
  }
}

function createPaymentAttemptModule(attempts: PaymentAttemptRecord[] = []) {
  const store = [...attempts]

  return {
    listPaymentAttempts: jest.fn(async () => store),
    updatePaymentAttempts: jest.fn(async (input) => {
      const rows = Array.isArray(input) ? input : [input]
      for (const row of rows) {
        const index = store.findIndex((attempt) => attempt.id === row.id)
        if (index >= 0) {
          store[index] = row
        }
      }
      return rows
    }),
    attempts: store,
  }
}

function createPaymentAttemptAuthorityConnection(
  paymentAttemptModule: ReturnType<typeof createPaymentAttemptModule>
) {
  const nullableString = (value: unknown): string | null =>
    value == null ? null : String(value)

  return {
    transaction: jest.fn(async (callback: (transaction: {
      raw: (sql: string, bindings?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>
    }) => Promise<unknown>) =>
      callback({
        raw: jest.fn(async (sql: string, bindings: unknown[] = []) => {
          const attemptFor = (value: unknown) => {
            const normalizedValue = nullableString(value)
            return paymentAttemptModule.attempts.find(
              (attempt) =>
                attempt.id === normalizedValue ||
                attempt.provider_payment_intent_id === normalizedValue
            )
          }

          if (sql.includes("pg_advisory_xact_lock")) {
            return { rows: [] }
          }

          if (sql.includes("select cart_id from payment_attempt")) {
            const attempt = attemptFor(bindings[0])
            return { rows: attempt ? [{ cart_id: attempt.cart_id }] : [] }
          }

          if (sql.includes("update payment_attempt")) {
            const normalizedSql = sql.replace(/\s+/g, " ").trim()
            const setAndWhere = normalizedSql.match(
              /\bset\s+(.+?)\s+\bwhere\b(.+)$/i
            )
            if (!setAndWhere) {
              throw new Error(`Unexpected PaymentAttempt update SQL: ${sql}`)
            }

            const setColumns = [
              ...setAndWhere[1].matchAll(
                /\b(provider_payment_intent_id|provider_payment_session_id|status|failed_at|canceled_at|updated_at)\s*=/gi
              ),
            ].map((match) => match[1].toLowerCase())
            let bindingIndex = 0
            const setValues: Record<string, unknown> = {}
            for (const column of setColumns) {
              setValues[column] = bindings[bindingIndex++]
            }

            const whereBindings = [
              { column: "id", pattern: /\bid\s*=\s*\?/gi },
              { column: "cart_id", pattern: /\bcart_id\s*=\s*\?/gi },
              {
                column: "provider_payment_intent_id",
                pattern: /\bprovider_payment_intent_id\s*=\s*\?/gi,
              },
              { column: "status", pattern: /\bstatus\s*=\s*\?/gi },
            ]
              .flatMap(({ column, pattern }) =>
                [...setAndWhere[2].matchAll(pattern)].map((match) => ({
                  column,
                  index: match.index ?? 0,
                }))
              )
              .sort((left, right) => left.index - right.index)

            if (whereBindings.length !== 4) {
              throw new Error(`Unexpected PaymentAttempt WHERE SQL: ${sql}`)
            }

            const whereValues: Record<string, unknown> = {}
            for (const { column } of whereBindings) {
              whereValues[column] = bindings[bindingIndex++]
            }

            const attempt = attemptFor(whereValues.id)
            if (
              !attempt ||
              attempt.cart_id !== String(whereValues.cart_id) ||
              attempt.order_id != null ||
              attempt.status !== whereValues.status ||
              (attempt.provider_payment_intent_id != null &&
                attempt.provider_payment_intent_id !==
                  String(whereValues.provider_payment_intent_id))
            ) {
              return { rows: [] }
            }

            const updated: PaymentAttemptRecord = {
              ...attempt,
              provider_payment_intent_id: nullableString(
                setValues.provider_payment_intent_id
              ),
              provider_payment_session_id:
                setValues.provider_payment_session_id == null
                  ? attempt.provider_payment_session_id
                  : String(setValues.provider_payment_session_id),
              status: String(setValues.status) as PaymentAttemptRecord["status"],
              updated_at:
                nullableString(setValues.updated_at) ?? attempt.updated_at,
              ...(Object.prototype.hasOwnProperty.call(setValues, "failed_at")
                ? { failed_at: nullableString(setValues.failed_at) }
                : {}),
              ...(Object.prototype.hasOwnProperty.call(setValues, "canceled_at")
                ? { canceled_at: nullableString(setValues.canceled_at) }
                : {}),
            }
            await paymentAttemptModule.updatePaymentAttempts(updated)
            return { rows: [{ ...updated }] }
          }

          if (sql.includes("from payment_attempt")) {
            const attempt = attemptFor(bindings[0])
            return attempt
              ? { rows: [{ ...attempt, metadata: attempt.metadata ?? { cart_resource_version: 1 } }] }
              : { rows: [] }
          }

          throw new Error(`Unexpected PaymentAttempt authority SQL: ${sql}`)
        }),
      })
    ),
  }
}

function createRequest(
  scopeResolve: jest.Mock,
  overrides: Partial<RequestWithRawBody> = {}
) {
  return {
    headers: {
      "stripe-signature": "t=1,v1=signature",
    },
    scope: {
      resolve: scopeResolve,
    },
    rawBody: Buffer.from('{"id":"evt_default","type":"payment_intent.succeeded"}'),
    correlationId: "corr_http_01",
    ...overrides,
  } as RequestWithRawBody
}

function createScopeResolve(input: {
  webhookService: ReturnType<typeof createStatefulWebhookService>
  paymentAttemptModule?: ReturnType<typeof createPaymentAttemptModule>
}) {
  const authorityConnection = input.paymentAttemptModule
    ? createPaymentAttemptAuthorityConnection(input.paymentAttemptModule)
    : undefined

  return jest.fn((key: string) => {
    if (key === WEBHOOKS_MODULE) {
      return input.webhookService
    }

    if (key === PAYMENT_ATTEMPT_MODULE) {
      return input.paymentAttemptModule
    }

    if (key === ContainerRegistrationKeys.PG_CONNECTION) {
      return authorityConnection
    }

    return undefined
  })
}

function createHandler(event: Record<string, unknown>) {
  return createStripeWebhookPostHandler({
    appEnv: {
      STRIPE_WEBHOOK_INGESTION_ENABLED: true,
      STRIPE_WEBHOOK_SECRET: "whsec_test_123",
    } as never,
    stripe: {
      webhooks: {
        constructEvent: jest.fn(() => event),
      },
    },
    now: () => new Date("2026-06-30T12:00:00.000Z"),
    runOrderEntrypoint: jest.fn(async (_scope, input) => ({
      status: "created",
      payment_attempt_id: input.payment_attempt_id,
      payment_intent_id: input.payment_intent_id,
      order_id: "order_http_01",
      stripe_event_id: input.stripe_event_id ?? null,
      correlation_id: input.correlation_id ?? null,
      checkout_completion_status: "completed",
      order_status: "confirmed",
      payment_status: "captured",
    })),
  })
}

function serializeProof(payload: unknown) {
  return JSON.stringify(payload)
}

describe("stripe webhook http contract", () => {
  it("registra raw body preserveRawBody para POST /hooks/stripe", () => {
    const route = defaultMiddlewares.routes.find(
      (entry) => entry.matcher === "/hooks/stripe"
    )

    expect(route).toBeDefined()
    expect(route?.method ?? route?.methods).toEqual(
      expect.arrayContaining(["POST"])
    )
    expect(route?.bodyParser).toEqual(
      expect.objectContaining({
        preserveRawBody: true,
      })
    )
  })

  it("payment_intent.succeeded confirma exatamente uma tentativa", async () => {
    const webhookService = createStatefulWebhookService()
    const paymentAttemptModule = createPaymentAttemptModule([buildAttempt()])
    const handler = createHandler({
      id: "evt_valid_http",
      type: "payment_intent.succeeded",
      livemode: false,
      data: {
        object: {
          id: "pi_http_123",
          object: "payment_intent",
          amount: 9900,
          amount_received: 9900,
          currency: "brl",
          metadata: {
            cart_id: "cart_http_01",
          },
          payment_method_types: ["card"],
        },
      },
    })
    const req = createRequest(
      createScopeResolve({
        webhookService,
        paymentAttemptModule,
      })
    )
    const res = createResponse()

    await handler(req, res)

    expect(res.statusCode).toBe(200)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        duplicate: false,
        status: "processed",
      })
    )
    expect(paymentAttemptModule.updatePaymentAttempts).toHaveBeenCalledTimes(1)
    expect(paymentAttemptModule.attempts).toHaveLength(1)
    expect(paymentAttemptModule.attempts[0]).toEqual(
      expect.objectContaining({
        id: "payatt_http_01",
        status: "payment_confirmed_by_webhook",
        order_id: null,
      })
    )
    expect(webhookService.records[0]).toEqual(
      expect.objectContaining({
        status: "processed",
        entity_type: "payment_attempt",
        entity_id: "payatt_http_01",
      })
    )

    const proof = serializeProof({
      body: res.json.mock.calls[0][0],
      webhookRecords: webhookService.records,
      attempts: paymentAttemptModule.attempts,
    })
    for (const forbidden of FORBIDDEN_STRINGS) {
      expect(proof).not.toContain(forbidden)
    }
  })

  it("payment_intent.payment_failed marca tentativa como payment_failed", async () => {
    const webhookService = createStatefulWebhookService()
    const paymentAttemptModule = createPaymentAttemptModule([buildAttempt()])
    const handler = createHandler({
      id: "evt_failed_http",
      type: "payment_intent.payment_failed",
      livemode: false,
      data: {
        object: {
          id: "pi_http_123",
          object: "payment_intent",
          amount: 9900,
          currency: "brl",
          metadata: {
            cart_id: "cart_http_01",
          },
          payment_method_types: ["card"],
        },
      },
    })
    const req = createRequest(
      createScopeResolve({
        webhookService,
        paymentAttemptModule,
      }),
      {
        rawBody: Buffer.from(
          '{"id":"evt_failed_http","type":"payment_intent.payment_failed"}'
        ),
      }
    )
    const res = createResponse()

    await handler(req, res)

    expect(res.statusCode).toBe(200)
    expect(paymentAttemptModule.attempts[0]).toEqual(
      expect.objectContaining({
        status: "payment_failed",
        order_id: null,
      })
    )
    expect(webhookService.records[0]?.status).toBe("processed")
  })

  it("payment_intent.canceled marca tentativa como payment_canceled", async () => {
    const webhookService = createStatefulWebhookService()
    const paymentAttemptModule = createPaymentAttemptModule([
      buildAttempt({
        status: "awaiting_pix_payment",
        payment_method_type: "pix",
      }),
    ])
    const handler = createHandler({
      id: "evt_canceled_http",
      type: "payment_intent.canceled",
      livemode: false,
      data: {
        object: {
          id: "pi_http_123",
          object: "payment_intent",
          amount: 9900,
          currency: "brl",
          metadata: {
            cart_id: "cart_http_01",
          },
          payment_method_types: ["pix"],
        },
      },
    })
    const req = createRequest(
      createScopeResolve({
        webhookService,
        paymentAttemptModule,
      }),
      {
        rawBody: Buffer.from(
          '{"id":"evt_canceled_http","type":"payment_intent.canceled"}'
        ),
      }
    )
    const res = createResponse()

    await handler(req, res)

    expect(res.statusCode).toBe(200)
    expect(paymentAttemptModule.attempts[0]).toEqual(
      expect.objectContaining({
        status: "payment_canceled",
        order_id: null,
      })
    )
    expect(webhookService.records[0]?.status).toBe("processed")
  })

  it("payment_intent sem tentativa nao cria Order nem crasha", async () => {
    const webhookService = createStatefulWebhookService()
    const paymentAttemptModule = createPaymentAttemptModule([])
    const handler = createHandler({
      id: "evt_missing_http",
      type: "payment_intent.succeeded",
      livemode: false,
      data: {
        object: {
          id: "pi_missing",
          object: "payment_intent",
          amount: 9900,
          amount_received: 9900,
          currency: "brl",
          metadata: {
            cart_id: "cart_http_01",
          },
          payment_method_types: ["card"],
        },
      },
    })
    const req = createRequest(
      createScopeResolve({
        webhookService,
        paymentAttemptModule,
      }),
      {
        rawBody: Buffer.from(
          '{"id":"evt_missing_http","type":"payment_intent.succeeded"}'
        ),
      }
    )
    const res = createResponse()

    await handler(req, res)

    expect(res.statusCode).toBe(200)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
      })
    )
    expect(paymentAttemptModule.updatePaymentAttempts).not.toHaveBeenCalled()
    expect(webhookService.records[0]).toEqual(
      expect.objectContaining({
        status: "failed",
        error_code: "PAYMENT_ATTEMPT_NOT_FOUND",
      })
    )
  })

  it("payment_intent com tentativa terminal nao e reativada", async () => {
    const webhookService = createStatefulWebhookService()
    const paymentAttemptModule = createPaymentAttemptModule([
      buildAttempt({ status: "payment_failed" }),
    ])
    const handler = createHandler({
      id: "evt_terminal_http",
      type: "payment_intent.succeeded",
      livemode: false,
      data: {
        object: {
          id: "pi_http_123",
          object: "payment_intent",
          amount: 9900,
          amount_received: 9900,
          currency: "brl",
          metadata: {
            cart_id: "cart_http_01",
          },
          payment_method_types: ["card"],
        },
      },
    })
    const req = createRequest(
      createScopeResolve({
        webhookService,
        paymentAttemptModule,
      }),
      {
        rawBody: Buffer.from(
          '{"id":"evt_terminal_http","type":"payment_intent.succeeded"}'
        ),
      }
    )
    const res = createResponse()

    await handler(req, res)

    expect(res.statusCode).toBe(200)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "ignored",
      })
    )
    expect(paymentAttemptModule.updatePaymentAttempts).not.toHaveBeenCalled()
    expect(paymentAttemptModule.attempts[0]?.status).toBe("payment_failed")
    expect(webhookService.records[0]?.status).toBe("ignored")
  })

  it("payment_intent deduplica replay sem duplicar mutacao", async () => {
    const webhookService = createStatefulWebhookService()
    const paymentAttemptModule = createPaymentAttemptModule([buildAttempt()])
    const handler = createHandler({
      id: "evt_replay_http",
      type: "payment_intent.succeeded",
      livemode: false,
      data: {
        object: {
          id: "pi_http_123",
          object: "payment_intent",
          amount: 9900,
          amount_received: 9900,
          currency: "brl",
          metadata: {
            cart_id: "cart_http_01",
          },
          payment_method_types: ["card"],
        },
      },
    })
    const scopeResolve = createScopeResolve({
      webhookService,
      paymentAttemptModule,
    })

    await handler(createRequest(scopeResolve), createResponse())
    const replayResponse = createResponse()
    await handler(createRequest(scopeResolve), replayResponse)

    expect(paymentAttemptModule.updatePaymentAttempts).toHaveBeenCalledTimes(1)
    expect(webhookService.records).toHaveLength(1)
    expect(replayResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        duplicate: true,
        status: "processed",
      })
    )
  })

  it("payment_intent com WebhookEventLog recebido processa tentativa e fecha como processed", async () => {
    const webhookService = createStatefulWebhookService([
      {
        id: "whlog_existing_received",
        provider: "stripe",
        external_event_id: "evt_existing_received",
        deduplication_key: "evt_existing_received",
        event_type: "payment_intent.succeeded",
        status: "received",
        entity_type: "unknown",
        entity_id: null,
        error_code: null,
        error_message: null,
        processed_at: null,
        failed_at: null,
        ignored_at: null,
        metadata: null,
      },
    ])
    const paymentAttemptModule = createPaymentAttemptModule([buildAttempt()])
    const handler = createHandler({
      id: "evt_existing_received",
      type: "payment_intent.succeeded",
      livemode: false,
      data: {
        object: {
          id: "pi_http_123",
          object: "payment_intent",
          amount: 9900,
          amount_received: 9900,
          currency: "brl",
          metadata: {
            cart_id: "cart_http_01",
          },
          payment_method_types: ["card"],
        },
      },
    })
    const res = createResponse()

    await handler(
      createRequest(
        createScopeResolve({
          webhookService,
          paymentAttemptModule,
        }),
        {
          rawBody: Buffer.from(
            '{"id":"evt_existing_received","type":"payment_intent.succeeded"}'
          ),
        }
      ),
      res
    )

    expect(res.statusCode).toBe(200)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        duplicate: true,
        status: "processed",
      })
    )
    expect(paymentAttemptModule.updatePaymentAttempts).toHaveBeenCalledTimes(1)
    expect(paymentAttemptModule.attempts[0]).toEqual(
      expect.objectContaining({
        status: "payment_confirmed_by_webhook",
        order_id: null,
      })
    )
    expect(webhookService.records[0]).toEqual(
      expect.objectContaining({
        id: "whlog_existing_received",
        status: "processed",
      })
    )
  })

  it("payment_intent com WebhookEventLog processed retorna duplicate final sem mutacao", async () => {
    const webhookService = createStatefulWebhookService([
      {
        id: "whlog_existing_processed",
        provider: "stripe",
        external_event_id: "evt_existing_processed",
        deduplication_key: "evt_existing_processed",
        event_type: "payment_intent.succeeded",
        status: "processed",
        entity_type: "payment_attempt",
        entity_id: "payatt_http_01",
        error_code: null,
        error_message: null,
        processed_at: "2026-06-30T12:00:00.000Z",
        failed_at: null,
        ignored_at: null,
        metadata: null,
      },
    ])
    const paymentAttemptModule = createPaymentAttemptModule([buildAttempt()])
    const handler = createHandler({
      id: "evt_existing_processed",
      type: "payment_intent.succeeded",
      livemode: false,
      data: {
        object: {
          id: "pi_http_123",
          object: "payment_intent",
          amount: 9900,
          amount_received: 9900,
          currency: "brl",
          metadata: {
            cart_id: "cart_http_01",
          },
          payment_method_types: ["card"],
        },
      },
    })
    const res = createResponse()

    await handler(
      createRequest(
        createScopeResolve({
          webhookService,
          paymentAttemptModule,
        }),
        {
          rawBody: Buffer.from(
            '{"id":"evt_existing_processed","type":"payment_intent.succeeded"}'
          ),
        }
      ),
      res
    )

    expect(res.statusCode).toBe(200)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        duplicate: true,
        status: "processed",
      })
    )
    expect(paymentAttemptModule.updatePaymentAttempts).not.toHaveBeenCalled()
    expect(webhookService.records[0]?.status).toBe("processed")
  })

  it("marca evento nao suportado como ignored e deduplica replay", async () => {
    const webhookService = createStatefulWebhookService()
    const handler = createHandler({
      id: "evt_ignored_http",
      type: "customer.created",
      livemode: false,
      data: {
        object: {
          id: "ch_http_123",
          object: "charge",
        },
      },
    })
    const scopeResolve = createScopeResolve({
      webhookService,
    })

    const firstReq = createRequest(scopeResolve, {
      rawBody: Buffer.from('{"id":"evt_ignored_http","type":"customer.created"}'),
    })
    const firstRes = createResponse()
    await handler(firstReq, firstRes)

    const secondReq = createRequest(scopeResolve, {
      rawBody: Buffer.from('{"id":"evt_ignored_http","type":"customer.created"}'),
    })
    const secondRes = createResponse()
    await handler(secondReq, secondRes)

    expect(firstRes.statusCode).toBe(200)
    expect(secondRes.statusCode).toBe(200)
    expect(webhookService.records).toHaveLength(1)
    expect(webhookService.records[0]?.status).toBe("ignored")
    expect(webhookService.createWebhookEventLogs).toHaveBeenCalledTimes(1)
    expect(secondRes.json).toHaveBeenCalledWith(
      expect.objectContaining({
        duplicate: true,
        status: "ignored",
      })
    )
  })
})
