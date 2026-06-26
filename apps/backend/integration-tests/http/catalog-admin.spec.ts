import { MedusaError, ProductStatus } from "@medusajs/framework/utils"
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  formatGelatoMetadataAdminMessage,
  mapGelatoMetadataErrorResponseBody,
} from "../../src/api/admin/products/validators"
import {
  sellableGateProductCreateMiddleware,
  sellableGateProductUpdateMiddleware,
} from "../../src/api/admin/products/sellable-gate-middleware"
import { GelatoMetadataError } from "../../src/modules/catalog/gelato-metadata"
import {
  isSellableVariant,
  mergeVariantForValidation,
  shouldEnforceSellableGate,
  toCatalogVariantInput,
  validateAdminProductCreate,
  validateAdminProductUpdate,
  validateSellableCatalogMutation,
} from "../../src/workflows/catalog/validate-sellable-variant"

const COMPLETE_GELATO_METADATA = {
  gelato_product_uid: "prod_gelato_abc123",
  gelato_template_id: "template_fixed_001",
  gelato_variant_options: {
    size: "M",
    color: "black",
  },
  template_mode: "fixed",
} as const

const CANARIES = {
  stack: "Error: boom\n    at secret-host.internal/path.ts:10:1",
  webhookSecret: "whsec_test_canary_value_12345",
  postgresUrl: "postgresql://user:secret@db.internal.example:5432/medusa",
} as const

function incompleteDraftVariant() {
  return {
    title: "Draft Tee",
    metadata: {},
    prices: [{ currency_code: "brl", amount: 9900 }],
  }
}

function sellableVariant() {
  return {
    title: "Sellable Tee",
    metadata: { ...COMPLETE_GELATO_METADATA },
    prices: [{ currency_code: "brl", amount: 9900 }],
  }
}

function expectNoCanaries(value: unknown) {
  const serialized = JSON.stringify(value)

  for (const canary of Object.values(CANARIES)) {
    expect(serialized).not.toContain(canary)
  }

  expect(serialized).not.toMatch(/\.ts:\d+:\d+/)
}

describe("catalog admin sellable gate", () => {
  describe("draft", () => {
    it("allows create draft product with incomplete gelato metadata", () => {
      expect(() =>
        validateSellableCatalogMutation({
          productStatus: ProductStatus.DRAFT,
          isPublishing: false,
          variants: [toCatalogVariantInput(incompleteDraftVariant())],
        })
      ).not.toThrow()
    })

    it("allows update draft product payload without enforcing sellable gate", () => {
      expect(
        shouldEnforceSellableGate({
          productStatus: ProductStatus.DRAFT,
          isPublishing: false,
        })
      ).toBe(false)
    })

    it("is_sellable is false for incomplete draft metadata", () => {
      expect(
        isSellableVariant(
          toCatalogVariantInput(incompleteDraftVariant())
        )
      ).toBe(false)
    })
  })

  describe("publish", () => {
    it("blocks publish when variants lack complete gelato metadata", () => {
      expect(() =>
        validateSellableCatalogMutation({
          productStatus: ProductStatus.PUBLISHED,
          isPublishing: true,
          variants: [toCatalogVariantInput(incompleteDraftVariant())],
        })
      ).toThrow(MedusaError)
    })

    it("blocks create published product with invalid gelato metadata", async () => {
      const container = {
        resolve: jest.fn(),
      }

      await expect(
        validateAdminProductCreate(container as never, {
          status: ProductStatus.PUBLISHED,
          variants: [incompleteDraftVariant()],
        })
      ).rejects.toMatchObject({
        type: MedusaError.Types.INVALID_DATA,
      })
    })

    it("allows publish transition when gelato metadata and BRL price are valid", () => {
      expect(() =>
        validateSellableCatalogMutation({
          productStatus: ProductStatus.PUBLISHED,
          isPublishing: true,
          variants: [toCatalogVariantInput(sellableVariant())],
        })
      ).not.toThrow()

      expect(
        isSellableVariant(toCatalogVariantInput(sellableVariant()))
      ).toBe(true)
    })
  })

  describe("update", () => {
    it("blocks updating a published product variant when merged metadata stays invalid", () => {
      expect(() =>
        validateSellableCatalogMutation({
          productStatus: ProductStatus.PUBLISHED,
          isPublishing: false,
          variants: [
            mergeVariantForValidation(
              {
                id: "variant_01",
                metadata: {},
                prices: [{ currency_code: "brl", amount: 9900 }],
              },
              {
                metadata: {
                  gelato_product_uid: "prod_gelato_abc123",
                },
              }
            ),
          ],
        })
      ).toThrow(MedusaError)
    })

    it("validates all existing variants when publishing without variant payload", async () => {
      const queryGraph = jest.fn(async () => ({
        data: [
          {
            id: "prod_01",
            status: ProductStatus.DRAFT,
            variants: [
              {
                id: "variant_01",
                metadata: {},
                prices: [{ currency_code: "brl", amount: 9900 }],
              },
            ],
          },
        ],
      }))

      const container = {
        resolve: jest.fn(() => ({ graph: queryGraph })),
      }

      await expect(
        validateAdminProductUpdate(container as never, "prod_01", {
          status: ProductStatus.PUBLISHED,
        })
      ).rejects.toMatchObject({
        type: MedusaError.Types.INVALID_DATA,
      })

      expect(queryGraph).toHaveBeenCalled()
    })
  })

  describe("gelato", () => {
    it("returns clear operator-facing error messages for incomplete metadata", () => {
      const message = formatGelatoMetadataAdminMessage({
        code: "GELATO_METADATA_INCOMPLETE",
        missing: ["gelato_product_uid", "gelato_template_id"],
      })

      expect(message).toContain("Gelato metadata is incomplete")
      expect(message).toContain("gelato_product_uid")
      expectNoCanaries(message)
    })

    it("maps gelato metadata errors without stack traces or secrets", () => {
      const error = new GelatoMetadataError({
        code: "GELATO_METADATA_INCOMPLETE",
        missing: ["gelato_product_uid"],
      })
      error.stack = CANARIES.stack

      const body = mapGelatoMetadataErrorResponseBody(error)

      expect(body.type).toBe(MedusaError.Types.INVALID_DATA)
      expect(body.message).toContain("cannot be published or sold")
      expectNoCanaries(body)
      expect(body.message).not.toContain(CANARIES.webhookSecret)
      expect(body.message).not.toContain(CANARIES.postgresUrl)
    })
  })

  describe("create middleware", () => {
    it("passes draft create requests with incomplete gelato metadata", async () => {
      const next = jest.fn()
      const req = {
        scope: { resolve: jest.fn() },
        validatedBody: {
          title: "Draft Shirt",
          status: ProductStatus.DRAFT,
          variants: [incompleteDraftVariant()],
        },
      } as unknown as MedusaRequest

      await sellableGateProductCreateMiddleware(req, {} as MedusaResponse, next)

      expect(next).toHaveBeenCalledTimes(1)
    })

    it("blocks published create requests before the handler runs", async () => {
      const next = jest.fn()
      const req = {
        scope: { resolve: jest.fn() },
        validatedBody: {
          title: "Published Shirt",
          status: ProductStatus.PUBLISHED,
          variants: [incompleteDraftVariant()],
        },
      } as unknown as MedusaRequest

      await expect(
        sellableGateProductCreateMiddleware(req, {} as MedusaResponse, next)
      ).rejects.toMatchObject({
        type: MedusaError.Types.INVALID_DATA,
      })

      expect(next).not.toHaveBeenCalled()
    })
  })

  describe("update middleware", () => {
    it("blocks publish update when existing variants remain invalid", async () => {
      const queryGraph = jest.fn(async () => ({
        data: [
          {
            id: "prod_01",
            status: ProductStatus.DRAFT,
            variants: [
              {
                id: "variant_01",
                metadata: {},
                prices: [{ currency_code: "brl", amount: 9900 }],
              },
            ],
          },
        ],
      }))

      const next = jest.fn()
      const req = {
        params: { id: "prod_01" },
        scope: {
          resolve: jest.fn(() => ({ graph: queryGraph })),
        },
        validatedBody: {
          status: ProductStatus.PUBLISHED,
        },
      } as unknown as MedusaRequest

      await expect(
        sellableGateProductUpdateMiddleware(req, {} as MedusaResponse, next)
      ).rejects.toMatchObject({
        type: MedusaError.Types.INVALID_DATA,
      })

      expect(next).not.toHaveBeenCalled()
    })
  })
})
