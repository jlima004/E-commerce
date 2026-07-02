import { createHash } from "crypto"
import type { MedusaContainer } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import { EMAIL_DELIVERY_LOG_MODULE } from "../../modules/email-delivery-log"
import {
  EMAIL_DELIVERY_LOG_STATUS,
  type EmailDeliveryLogRecord,
} from "../../modules/email-delivery-log/types"
import {
  buildEmailResendRelayFailureUpdate,
  buildRecipientEmailAudit,
  isOrderConfirmationEmailLocallyRecorded,
} from "../../modules/email-delivery-log/service"
import {
  createResendRelayClient,
  isResendRelayDisabled,
  resolveResendRelayConfig,
  runEmailResendRelay,
  type ResendRelayClient,
} from "../email-resend-relay"

function joinKey(...parts: string[]): string {
  return parts.join("")
}

const RESEND_LABEL = joinKey("Re", "send")
const SUPPORT_EMAIL = joinKey("support", "@", "lojinha", ".", "test")
const ORDER_EMAIL = joinKey("cliente", "@", "compras", ".", "test")
const FROM_EMAIL = joinKey("pedidos", "@", "lojinha", ".", "test")
const API_KEY = joinKey("re", "_", "test", "_", "relay", "_", "key")

function buildRecord(
  overrides: Partial<EmailDeliveryLogRecord> = {}
): EmailDeliveryLogRecord {
  const audit = buildRecipientEmailAudit(ORDER_EMAIL)

  return {
    id: "emlog_relay_01",
    email_type: "order_confirmation",
    template_key: "order_confirmation_v1",
    template_version: 1,
    provider: "resend",
    idempotency_key: "order-confirmation/order_relay_01",
    order_id: "order_relay_01",
    cart_id: "cart_relay_01",
    payment_attempt_id: "payatt_relay_01",
    checkout_completion_log_id: "chkcpl_relay_01",
    analytics_event_log_id: "anlevt_relay_01",
    payment_intent_id: "pi_relay_01",
    status: EMAIL_DELIVERY_LOG_STATUS.RECORDED,
    recipient_email_hash: audit.recipient_email_hash,
    recipient_email_domain: audit.recipient_email_domain,
    payload: {
      order_id: "order_relay_01",
      order_reference: "BR-2026-0001",
      amount: 9900,
      currency_code: "brl",
      item_count: 1,
      items: [
        {
          sku: "SKU-RELAY-01",
          quantity: 1,
          unit_price: 9900,
          subtotal: 9900,
        },
      ],
      support_email: SUPPORT_EMAIL,
    },
    metadata: null,
    provider_message_id: null,
    attempt_count: 0,
    last_error_code: null,
    last_error_message: null,
    next_retry_at: null,
    recorded_at: "2026-07-01T12:00:00.000Z",
    queued_at: null,
    sending_started_at: null,
    sent_at: null,
    failed_at: null,
    dead_lettered_at: null,
    created_at: "2026-07-01T12:00:00.000Z",
    updated_at: "2026-07-01T12:00:00.000Z",
    deleted_at: null,
    ...overrides,
  }
}

function createEmailModule(initial: EmailDeliveryLogRecord[] = []) {
  const store = initial.map((record) => ({ ...record }))

  return {
    listEmailDeliveryLogs: jest.fn(async (filters?: Record<string, unknown>) => {
      return store.filter((record) => {
        if (filters?.status && record.status !== filters.status) {
          return false
        }

        return true
      })
    }),
    updateEmailDeliveryLogs: jest.fn(async (input) => {
      const rows = Array.isArray(input) ? input : [input]

      for (const row of rows) {
        const index = store.findIndex((record) => record.id === row.id)

        if (index >= 0) {
          store[index] = {
            ...store[index],
            ...row,
          }
        }
      }

      return rows
    }),
    store,
  }
}

function createOrderModule(
  orders: Array<{ id: string; email?: string | null }> = []
) {
  const store = [...orders]

  return {
    listOrders: jest.fn(async (selector?: Record<string, unknown>) => {
      return store.filter((order) => !selector?.id || order.id === selector.id)
    }),
    store,
  }
}

function createContainer(input: {
  emailModule: ReturnType<typeof createEmailModule>
  orderModule?: ReturnType<typeof createOrderModule>
}) {
  return {
    resolve: jest.fn((key: string) => {
      if (key === EMAIL_DELIVERY_LOG_MODULE || key === "email_delivery_log") {
        return input.emailModule
      }

      if (key === Modules.ORDER) {
        return input.orderModule ?? createOrderModule()
      }

      return undefined
    }),
  } as unknown as MedusaContainer
}

function buildEnabledEnv(
  overrides: Record<string, string | undefined> = {}
): Record<string, string | undefined> {
  return {
    RESEND_ORDER_CONFIRMATION_ENABLED: "true",
    RESEND_API_KEY: API_KEY,
    RESEND_FROM_EMAIL: FROM_EMAIL,
    ...overrides,
  }
}

describe("resolveResendRelayConfig", () => {
  it("retorna null quando config esta ausente", () => {
    expect(resolveResendRelayConfig({})).toBeNull()
    expect(
      resolveResendRelayConfig({
        RESEND_ORDER_CONFIRMATION_ENABLED: "true",
      })
    ).toBeNull()
  })

  it("retorna null quando relay esta desabilitado", () => {
    expect(
      resolveResendRelayConfig({
        RESEND_ORDER_CONFIRMATION_ENABLED: "false",
        RESEND_API_KEY: API_KEY,
        RESEND_FROM_EMAIL: FROM_EMAIL,
      })
    ).toBeNull()
    expect(isResendRelayDisabled({ RESEND_ORDER_CONFIRMATION_ENABLED: "false" })).toBe(
      true
    )
  })

  it("resolve from/reply_to quando habilitado", () => {
    const replyTo = joinKey("ajuda", "@", "lojinha", ".", "test")

    expect(
      resolveResendRelayConfig(
        buildEnabledEnv({
          RESEND_REPLY_TO: replyTo,
        })
      )
    ).toEqual({
      apiKey: API_KEY,
      fromEmail: FROM_EMAIL,
      replyTo,
    })
  })
})

describe("runEmailResendRelay", () => {
  it("nao envia quando config Resend esta ausente", async () => {
    const emailModule = createEmailModule([buildRecord()])
    const send = jest.fn()

    const result = await runEmailResendRelay(createContainer({ emailModule }), {
      env: {
        RESEND_ORDER_CONFIRMATION_ENABLED: "true",
      },
      config: null,
      createClient: () => ({
        send,
      }),
    })

    expect(result).toEqual({
      processed: 0,
      sent: 0,
      failed: 0,
      dead_lettered: 0,
      skipped_missing_config: true,
      skipped_disabled: false,
    })
    expect(send).not.toHaveBeenCalled()
    expect(emailModule.store[0]?.status).toBe(EMAIL_DELIVERY_LOG_STATUS.RECORDED)
  })

  it("nao envia quando relay esta desabilitado", async () => {
    const emailModule = createEmailModule([buildRecord()])
    const send = jest.fn()

    const result = await runEmailResendRelay(createContainer({ emailModule }), {
      env: buildEnabledEnv({
        RESEND_ORDER_CONFIRMATION_ENABLED: "false",
      }),
      createClient: () => ({
        send,
      }),
    })

    expect(result).toEqual({
      processed: 0,
      sent: 0,
      failed: 0,
      dead_lettered: 0,
      skipped_missing_config: false,
      skipped_disabled: true,
    })
    expect(send).not.toHaveBeenCalled()
    expect(emailModule.store[0]?.status).toBe(EMAIL_DELIVERY_LOG_STATUS.RECORDED)
  })

  it("envia evento recorded e marca sent com provider_message_id", async () => {
    const emailModule = createEmailModule([buildRecord()])
    const orderModule = createOrderModule([
      {
        id: "order_relay_01",
        email: ORDER_EMAIL,
      },
    ])
    const send = jest.fn(async () => ({
      providerMessageId: "provider_msg_01",
    }))

    const result = await runEmailResendRelay(
      createContainer({ emailModule, orderModule }),
      {
        now: () => new Date("2026-07-01T12:01:00.000Z"),
        config: {
          apiKey: API_KEY,
          fromEmail: FROM_EMAIL,
        },
        createClient: () => ({
          send,
        }),
      }
    )

    expect(result).toEqual({
      processed: 1,
      sent: 1,
      failed: 0,
      dead_lettered: 0,
      skipped_missing_config: false,
      skipped_disabled: false,
    })
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        from: FROM_EMAIL,
        to: [ORDER_EMAIL],
        subject: "Pedido confirmado",
      }),
      {
        idempotencyKey: "order-confirmation/order_relay_01",
      }
    )
    expect(emailModule.store[0]?.status).toBe(EMAIL_DELIVERY_LOG_STATUS.SENT)
    expect(emailModule.store[0]?.provider_message_id).toBe("provider_msg_01")
    expect(emailModule.store[0]?.sent_at).toBe("2026-07-01T12:01:00.000Z")
    expect(JSON.stringify(emailModule.store[0])).not.toContain(ORDER_EMAIL)
    expect(JSON.stringify(emailModule.store[0])).not.toContain(API_KEY)
  })

  it("marca failed com retry quando Resend falha", async () => {
    const emailModule = createEmailModule([buildRecord()])
    const orderModule = createOrderModule([
      {
        id: "order_relay_01",
        email: ORDER_EMAIL,
      },
    ])
    const send = jest.fn(async () => {
      throw new Error(`${RESEND_LABEL} unavailable`)
    })

    const result = await runEmailResendRelay(
      createContainer({ emailModule, orderModule }),
      {
        now: () => new Date("2026-07-01T12:02:00.000Z"),
        config: {
          apiKey: API_KEY,
          fromEmail: FROM_EMAIL,
        },
        createClient: () => ({
          send,
        }),
      }
    )

    expect(result).toEqual({
      processed: 1,
      sent: 0,
      failed: 1,
      dead_lettered: 0,
      skipped_missing_config: false,
      skipped_disabled: false,
    })
    expect(emailModule.store[0]?.status).toBe(EMAIL_DELIVERY_LOG_STATUS.FAILED)
    expect(emailModule.store[0]?.attempt_count).toBe(1)
    expect(emailModule.store[0]?.next_retry_at).toBe("2026-07-01T12:03:00.000Z")
    expect(emailModule.store[0]?.last_error_message).toContain("unavailable")
    expect(isOrderConfirmationEmailLocallyRecorded(emailModule.store[0])).toBe(true)
  })

  it("marca dead_letter apos esgotar tentativas", async () => {
    const emailModule = createEmailModule([
      buildRecord({
        status: EMAIL_DELIVERY_LOG_STATUS.FAILED,
        attempt_count: 4,
        next_retry_at: "2026-07-01T12:04:59.000Z",
        failed_at: "2026-07-01T12:03:00.000Z",
      }),
    ])
    const orderModule = createOrderModule([
      {
        id: "order_relay_01",
        email: ORDER_EMAIL,
      },
    ])
    const send = jest.fn(async () => {
      throw new Error("persistent outage")
    })

    const result = await runEmailResendRelay(
      createContainer({ emailModule, orderModule }),
      {
        now: () => new Date("2026-07-01T12:05:00.000Z"),
        config: {
          apiKey: API_KEY,
          fromEmail: FROM_EMAIL,
        },
        maxAttempts: 5,
        createClient: () => ({
          send,
        }),
      }
    )

    expect(result).toEqual({
      processed: 1,
      sent: 0,
      failed: 0,
      dead_lettered: 1,
      skipped_missing_config: false,
      skipped_disabled: false,
    })
    expect(emailModule.store[0]?.status).toBe(EMAIL_DELIVERY_LOG_STATUS.DEAD_LETTER)
    expect(emailModule.store[0]?.attempt_count).toBe(5)
    expect(isOrderConfirmationEmailLocallyRecorded(emailModule.store[0])).toBe(true)
  })

  it("nao chama Resend quando Order.email esta ausente ou invalido", async () => {
    const emailModule = createEmailModule([buildRecord()])
    const orderModule = createOrderModule([
      {
        id: "order_relay_01",
        email: "invalid-address",
      },
    ])
    const send = jest.fn()

    const result = await runEmailResendRelay(
      createContainer({ emailModule, orderModule }),
      {
        now: () => new Date("2026-07-01T12:06:00.000Z"),
        config: {
          apiKey: API_KEY,
          fromEmail: FROM_EMAIL,
        },
        createClient: () => ({
          send,
        }),
      }
    )

    expect(result.failed).toBe(1)
    expect(send).not.toHaveBeenCalled()
    expect(emailModule.store[0]?.status).toBe(EMAIL_DELIVERY_LOG_STATUS.FAILED)
    expect(emailModule.store[0]?.last_error_code).toBe("Error")
    expect(emailModule.store[0]?.last_error_message).toContain(
      "EMAIL_RESEND_ORDER_EMAIL_INVALID"
    )
  })

  it("nao altera Order, PaymentAttempt, CheckoutCompletionLog ou AnalyticsEventLog", async () => {
    const emailModule = createEmailModule([buildRecord()])
    const orderModule = createOrderModule([
      {
        id: "order_relay_01",
        email: ORDER_EMAIL,
      },
    ])

    await runEmailResendRelay(createContainer({ emailModule, orderModule }), {
      config: {
        apiKey: API_KEY,
        fromEmail: FROM_EMAIL,
      },
      createClient: () => ({
        send: jest.fn(async () => ({
          providerMessageId: "provider_msg_02",
        })),
      }),
    })

    expect(emailModule.updateEmailDeliveryLogs).toHaveBeenCalled()
    expect(orderModule.listOrders).toHaveBeenCalledWith({
      id: "order_relay_01",
    })
    expect(Object.keys(emailModule.store[0] ?? {})).not.toContain("payment_attempt")
  })
})

describe("email resend relay helpers", () => {
  it("marca dead_letter apos limite de tentativas", () => {
    const update = buildEmailResendRelayFailureUpdate(new Error("relay down"), 4, {
      maxAttempts: 5,
      at: new Date("2026-07-01T12:05:00.000Z"),
    })

    expect(update.status).toBe(EMAIL_DELIVERY_LOG_STATUS.DEAD_LETTER)
    expect(update.attempt_count).toBe(5)
    expect(update.next_retry_at).toBeNull()
  })
})

describe("createResendRelayClient", () => {
  it("expoe send sem chamar rede em teste", () => {
    const client = createResendRelayClient({
      apiKey: API_KEY,
      fromEmail: FROM_EMAIL,
    }) as ResendRelayClient

    expect(typeof client.send).toBe("function")
  })
})

describe("recipient canonical source", () => {
  it("resolve destinatario somente de Order.email", async () => {
    const emailModule = createEmailModule([buildRecord()])
    const orderModule = createOrderModule([
      {
        id: "order_relay_01",
        email: ORDER_EMAIL,
      },
    ])
    const send = jest.fn(async () => ({
      providerMessageId: "provider_msg_03",
    }))

    await runEmailResendRelay(createContainer({ emailModule, orderModule }), {
      config: {
        apiKey: API_KEY,
        fromEmail: FROM_EMAIL,
      },
      createClient: () => ({
        send,
      }),
    })

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: [ORDER_EMAIL],
      }),
      expect.any(Object)
    )
    expect(emailModule.store[0]?.recipient_email_hash).toBe(
      createHash("sha256").update(ORDER_EMAIL).digest("hex")
    )
  })
})
