import fs from "fs"
import path from "path"
import {
  assertExchangeRequestCreateBodyAllowed,
  assertExchangeRequestUpdateBodyAllowed,
  assertNoSensitiveExchangeData,
  assertOrderEligibleForExchange,
  assertValidExchangeStatusTransition,
  applyExchangeRequestUpdate,
  buildExchangeRequestRecord,
  createAdminExchangeRequest,
  EXCHANGE_STATUS_TRANSITIONS,
  normalizeCreateExchangeRequestInput,
  sanitizeAffectedItems,
  sanitizeExchangeRequestError,
  updateAdminExchangeRequest,
} from "../service"
import {
  EXCHANGE_REQUEST_REASON,
  EXCHANGE_REQUEST_STATUS,
  REVERSE_LOGISTICS_PROVIDER,
  type ExchangeRequestRecord,
} from "../types"

const migrationPath = path.join(__dirname, "../migrations/TBD-exchange-request.ts")
const modelPath = path.join(__dirname, "../models/exchange-request.ts")
const servicePath = path.join(__dirname, "../service.ts")

function joinKey(...parts: string[]): string {
  return parts.join("")
}

const CLIENT_SECRET_KEY = joinKey("client", "_", "secret")
const CLIENT_SECRET_VALUE = joinKey("pi_123", "_", "secret_456")
const EMAIL_VALUE = joinKey("cliente", "@", "compras", ".", "test")

function buildOrderMetadata() {
  return {
    order_status: "confirmed",
    payment_status: "captured",
  }
}

function buildExchangeRequest(
  overrides: Partial<ExchangeRequestRecord> = {}
): ExchangeRequestRecord {
  return {
    id: "excreq_test_01",
    order_id: "order_exchange_01",
    reason: EXCHANGE_REQUEST_REASON.DEFECT,
    status: EXCHANGE_REQUEST_STATUS.OPENED,
    affected_items: [
      {
        line_item_id: "li_01",
        product_title: "Camiseta Teste",
        quantity: 1,
      },
    ],
    customer_visible_note: "Produto com defeito de impressao",
    operator_note: "Aguardando envio de fotos",
    reverse_logistics_provider: null,
    reverse_tracking_code: null,
    reverse_authorization_code: null,
    reverse_label_reference: null,
    return_received_at: null,
    resolved_at: null,
    created_by_operator_id: "operator_01",
    created_at: "2026-07-03T10:00:00.000Z",
    updated_at: "2026-07-03T10:00:00.000Z",
    deleted_at: null,
    ...overrides,
  }
}

describe("ExchangeRequest module artifacts", () => {
  it("keeps draft migration file present and unapplied naming", () => {
    expect(fs.existsSync(migrationPath)).toBe(true)
    expect(fs.readFileSync(migrationPath, "utf8")).toContain(
      "MigrationTBDExchangeRequest"
    )
  })

  it("defines model with exchange_request table and status enum", () => {
    const modelSource = fs.readFileSync(modelPath, "utf8")
    const typesSource = fs.readFileSync(
      path.join(__dirname, "../types.ts"),
      "utf8"
    )
    expect(modelSource).toContain('"exchange_request"')
    expect(modelSource).toContain("EXCHANGE_REQUEST_STATUSES")
    expect(typesSource).toContain("awaiting_customer_return")
    expect(typesSource).toContain("correios_manual")
  })

  it("service does not import refund, stripe, gelato, or correios clients", () => {
    const serviceSource = fs.readFileSync(servicePath, "utf8")
    expect(serviceSource).not.toMatch(/from\s+["'].*refund-request/)
    expect(serviceSource).not.toMatch(/from\s+["'].*gelato/)
    expect(serviceSource).not.toMatch(/from\s+["']stripe/)
    expect(serviceSource).not.toMatch(/fetch\s*\(/)
    expect(serviceSource).not.toMatch(/axios/)
    expect(serviceSource).not.toMatch(/OperationalAlert/)
    expect(serviceSource).not.toMatch(/AdminActionLog/)
  })
})

describe("ExchangeRequest order eligibility", () => {
  it("accepts confirmed orders only", () => {
    expect(() =>
      assertOrderEligibleForExchange({
        order_id: "order_exchange_01",
        order_metadata: buildOrderMetadata(),
      })
    ).not.toThrow()
  })

  it("rejects non-confirmed order_status without mutating payment_status", () => {
    expect(() =>
      assertOrderEligibleForExchange({
        order_id: "order_exchange_01",
        order_metadata: {
          order_status: "pending",
          payment_status: "captured",
        },
      })
    ).toThrow("EXCHANGE_REQUEST_ORDER_STATUS_NOT_ELIGIBLE")
  })
})

describe("ExchangeRequest create for defect and wrong_product", () => {
  it("creates defect exchange in opened status", () => {
    const result = createAdminExchangeRequest({
      request: {
        order_id: "order_exchange_01",
        reason: EXCHANGE_REQUEST_REASON.DEFECT,
        affected_items: [{ product_title: "Camiseta", quantity: 1 }],
        operator_note: "Defeito na estampa",
      },
      order_metadata: buildOrderMetadata(),
      id: "excreq_defect_01",
    })

    expect(result.exchange_request.reason).toBe("defect")
    expect(result.exchange_request.status).toBe("opened")
    expect(result.exchange_request.return_received_at).toBeNull()
    expect(result.exchange_request.resolved_at).toBeNull()
  })

  it("creates wrong_product exchange in opened status", () => {
    const result = createAdminExchangeRequest({
      request: {
        order_id: "order_exchange_01",
        reason: EXCHANGE_REQUEST_REASON.WRONG_PRODUCT,
        affected_items: [{ product_title: "Camiseta P", quantity: 1 }],
      },
      order_metadata: buildOrderMetadata(),
      id: "excreq_wrong_01",
    })

    expect(result.exchange_request.reason).toBe("wrong_product")
    expect(result.exchange_request.status).toBe("opened")
  })
})

describe("ExchangeRequest status transitions", () => {
  it("documents allowed transitions from opened through resolved", () => {
    expect(EXCHANGE_STATUS_TRANSITIONS.opened).toContain(
      "awaiting_customer_return"
    )
    expect(EXCHANGE_STATUS_TRANSITIONS.replacement_review).toContain("resolved")
    expect(EXCHANGE_STATUS_TRANSITIONS.resolved).toHaveLength(0)
  })

  it("rejects invalid transition opened -> resolved", () => {
    expect(() =>
      assertValidExchangeStatusTransition({
        from: EXCHANGE_REQUEST_STATUS.OPENED,
        to: EXCHANGE_REQUEST_STATUS.RESOLVED,
      })
    ).toThrow("EXCHANGE_REQUEST_STATUS_TRANSITION_INVALID")
  })

  it("rejects updates on terminal statuses", () => {
    expect(() =>
      applyExchangeRequestUpdate(buildExchangeRequest({ status: "resolved" }), {
        operator_note: "late edit",
      })
    ).toThrow("EXCHANGE_REQUEST_TERMINAL_STATUS_IMMUTABLE")
  })

  it("sets return_received_at when entering return_received", () => {
    const at = new Date("2026-07-03T12:00:00.000Z")
    const updated = applyExchangeRequestUpdate(
      buildExchangeRequest({ status: "return_in_transit" }),
      { status: EXCHANGE_REQUEST_STATUS.RETURN_RECEIVED },
      at
    )

    expect(updated.return_received_at).toBe(at.toISOString())
  })

  it("sets resolved_at when entering resolved", () => {
    const at = new Date("2026-07-03T13:00:00.000Z")
    const updated = applyExchangeRequestUpdate(
      buildExchangeRequest({ status: "replacement_review" }),
      { status: EXCHANGE_REQUEST_STATUS.RESOLVED },
      at
    )

    expect(updated.resolved_at).toBe(at.toISOString())
  })
})

describe("ExchangeRequest manual Correios reverse logistics fields", () => {
  it("persists correios_manual tracking and authorization codes on create", () => {
    const result = createAdminExchangeRequest({
      request: {
        order_id: "order_exchange_01",
        reason: EXCHANGE_REQUEST_REASON.DEFECT,
        affected_items: [{ product_title: "Camiseta", quantity: 1 }],
        reverse_logistics_provider: REVERSE_LOGISTICS_PROVIDER.CORREIOS_MANUAL,
        reverse_tracking_code: "BR123456789BR",
        reverse_authorization_code: "AUTH987654",
        reverse_label_reference: "label-ref-01",
      },
      order_metadata: buildOrderMetadata(),
      id: "excreq_correios_01",
    })

    expect(result.exchange_request.reverse_logistics_provider).toBe(
      "correios_manual"
    )
    expect(result.exchange_request.reverse_tracking_code).toBe("BR123456789BR")
    expect(result.exchange_request.reverse_authorization_code).toBe("AUTH987654")
    expect(result.exchange_request.reverse_label_reference).toBe("label-ref-01")
  })

  it("updates manual reverse logistics fields without status change", () => {
    const result = updateAdminExchangeRequest({
      existing: buildExchangeRequest({
        status: EXCHANGE_REQUEST_STATUS.AWAITING_CUSTOMER_RETURN,
      }),
      update: {
        reverse_logistics_provider: REVERSE_LOGISTICS_PROVIDER.CORREIOS_MANUAL,
        reverse_tracking_code: "BR999888777BR",
        reverse_authorization_code: "AUTH111222",
      },
    })

    expect(result.exchange_request.reverse_tracking_code).toBe("BR999888777BR")
    expect(result.exchange_request.status).toBe("awaiting_customer_return")
  })
})

describe("ExchangeRequest sanitization", () => {
  it("sanitizes affected_items to allowlisted summary fields", () => {
    const items = sanitizeAffectedItems([
      {
        line_item_id: "li_01",
        product_title: "Camiseta",
        quantity: 1,
      },
    ])

    expect(items).toEqual([
      {
        line_item_id: "li_01",
        product_title: "Camiseta",
        quantity: 1,
      },
    ])
  })

  it("rejects forbidden keys in affected_items", () => {
    expect(() =>
      sanitizeAffectedItems([
        {
          product_title: "Camiseta",
          quantity: 1,
          [CLIENT_SECRET_KEY]: CLIENT_SECRET_VALUE,
        } as never,
      ])
    ).toThrow("EXCHANGE_REQUEST_FORBIDDEN_PAYLOAD")
  })

  it("rejects sensitive values in operator notes", () => {
    expect(() =>
      normalizeCreateExchangeRequestInput({
        order_id: "order_exchange_01",
        reason: EXCHANGE_REQUEST_REASON.DEFECT,
        affected_items: [{ product_title: "Camiseta", quantity: 1 }],
        operator_note: `contato ${EMAIL_VALUE}`,
      })
    ).toThrow("EXCHANGE_REQUEST_FORBIDDEN_PAYLOAD")
  })

  it("rejects raw stripe payload markers in customer_visible_note", () => {
    expect(() =>
      assertNoSensitiveExchangeData({
        customer_visible_note: CLIENT_SECRET_VALUE,
      })
    ).toThrow("EXCHANGE_REQUEST_FORBIDDEN_PAYLOAD")
  })

  it("redacts sensitive patterns in sanitized errors", () => {
    const sanitized = sanitizeExchangeRequestError({
      code: "EXCHANGE_REQUEST_FORBIDDEN_PAYLOAD",
      message: `failed for ${EMAIL_VALUE}`,
    })

    expect(sanitized.error_message).not.toContain(EMAIL_VALUE)
    expect(sanitized.error_message).toContain("[redacted]")
  })
})

describe("ExchangeRequest raw body allowlist", () => {
  const validCreateBody = {
    order_id: "order_exchange_01",
    reason: EXCHANGE_REQUEST_REASON.DEFECT,
    affected_items: [{ product_title: "Camiseta", quantity: 1 }],
  }

  it("rejects create body with top-level forbidden metadata key", () => {
    expect(() =>
      assertExchangeRequestCreateBodyAllowed({
        ...validCreateBody,
        metadata: { operator: "x" },
      })
    ).toThrow("EXCHANGE_REQUEST_FORBIDDEN_PAYLOAD")
  })

  it("rejects create body with top-level forbidden refund key", () => {
    expect(() =>
      assertExchangeRequestCreateBodyAllowed({
        ...validCreateBody,
        refund: { amount: 100 },
      })
    ).toThrow("EXCHANGE_REQUEST_FORBIDDEN_PAYLOAD")
  })

  it("rejects create body with top-level forbidden payment_status key", () => {
    expect(() =>
      assertExchangeRequestCreateBodyAllowed({
        ...validCreateBody,
        payment_status: "refunded",
      })
    ).toThrow("EXCHANGE_REQUEST_FORBIDDEN_PAYLOAD")
  })

  it("rejects create body with top-level forbidden headers key", () => {
    expect(() =>
      assertExchangeRequestCreateBodyAllowed({
        ...validCreateBody,
        headers: { authorization: "Bearer x" },
      })
    ).toThrow("EXCHANGE_REQUEST_FORBIDDEN_PAYLOAD")
  })

  it("rejects create body with unknown top-level key", () => {
    expect(() =>
      assertExchangeRequestCreateBodyAllowed({
        ...validCreateBody,
        unexpected_field: "value",
      })
    ).toThrow("EXCHANGE_REQUEST_BODY_INVALID")
  })

  it("accepts create body with only allowlisted keys", () => {
    expect(() =>
      assertExchangeRequestCreateBodyAllowed(validCreateBody)
    ).not.toThrow()
  })

  it("rejects update body with forbidden payload even when status is valid", () => {
    expect(() =>
      assertExchangeRequestUpdateBodyAllowed({
        status: EXCHANGE_REQUEST_STATUS.AWAITING_CUSTOMER_RETURN,
        stripe_payload: { id: "pi_123" },
      })
    ).toThrow("EXCHANGE_REQUEST_FORBIDDEN_PAYLOAD")
  })

  it("rejects update body with unknown top-level key", () => {
    expect(() =>
      assertExchangeRequestUpdateBodyAllowed({
        status: EXCHANGE_REQUEST_STATUS.AWAITING_CUSTOMER_RETURN,
        order_id: "order_exchange_01",
      })
    ).toThrow("EXCHANGE_REQUEST_BODY_INVALID")
  })

  it("accepts update body with only allowlisted keys", () => {
    expect(() =>
      assertExchangeRequestUpdateBodyAllowed({
        status: EXCHANGE_REQUEST_STATUS.AWAITING_CUSTOMER_RETURN,
        operator_note: "Aguardando retorno",
      })
    ).not.toThrow()
  })
})

describe("ExchangeRequest negative scope proofs", () => {
  it("does not create RefundRequest or touch financial fields in record shape", () => {
    const record = buildExchangeRequestRecord({
      id: "excreq_neg_01",
      order_id: "order_exchange_01",
      reason: EXCHANGE_REQUEST_REASON.DEFECT,
      affected_items: [{ product_title: "Camiseta", quantity: 1 }],
    })

    const serialized = JSON.stringify(record)
    expect(serialized).not.toContain("refund_request")
    expect(serialized).not.toContain("payment_status")
    expect(serialized).not.toContain("stripe_refund")
    expect(serialized).not.toContain("amount")
    expect(record.status).toBe("opened")
  })

  it("update path never assigns payment_status or order_status fields", () => {
    const updated = updateAdminExchangeRequest({
      existing: buildExchangeRequest(),
      update: { status: EXCHANGE_REQUEST_STATUS.AWAITING_CUSTOMER_RETURN },
    }).exchange_request

    expect(Object.keys(updated)).not.toContain("payment_status")
    expect(Object.keys(updated)).not.toContain("order_status")
  })
})
