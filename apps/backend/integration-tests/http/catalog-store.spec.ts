import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import defaultMiddlewares from "../../src/api/middlewares"
import {
  applyStoreCatalogQueryConfig,
  storeCatalogPublicFields,
} from "../../src/api/store/products/query-config"
import { storeCatalogResponseMiddleware } from "../../src/api/store/products/serializers"
import { GET as listStoreProducts } from "../../../../node_modules/@medusajs/medusa/dist/api/store/products/route.js"
import { GET as retrieveStoreProduct } from "../../../../node_modules/@medusajs/medusa/dist/api/store/products/[id]/route.js"

const COMPLETE_GELATO_METADATA = {
  gelato_product_uid: "prod_gelato_abc123",
  gelato_template_id: "template_fixed_001",
  gelato_variant_options: {
    size: "M",
    color: "Preto",
  },
  template_mode: "fixed",
} as const

const PUBLIC_IMAGE_URL =
  "https://exampleproject.supabase.co/storage/v1/object/public/product-images/tee-black-front.png"

function createRawProduct() {
  return {
    id: "prod_01",
    title: "Camiseta Essential",
    subtitle: "Malha premium",
    description: "Camiseta algodao penteado",
    handle: "camiseta-essential",
    thumbnail: PUBLIC_IMAGE_URL,
    images: [
      {
        id: "img_01",
        url: PUBLIC_IMAGE_URL,
      },
    ],
    options: [
      {
        id: "opt_size",
        title: "Tamanho",
        values: [
          { id: "optval_size_m", value: "M" },
          { id: "optval_size_g", value: "G" },
        ],
      },
      {
        id: "opt_color",
        title: "Cor",
        values: [{ id: "optval_color_black", value: "Preto" }],
      },
    ],
    variants: [
      {
        id: "variant_sellable",
        title: "Preto / M",
        sku: "TSHIRT-BLACK-M",
        metadata: { ...COMPLETE_GELATO_METADATA },
        prices: [{ currency_code: "brl", amount: 99 }],
        options: [
          { id: "optval_size_m", value: "M" },
          { id: "optval_color_black", value: "Preto" },
        ],
      },
      {
        id: "variant_draft",
        title: "Preto / G",
        sku: "TSHIRT-BLACK-G",
        metadata: {
          gelato_product_uid: "prod_gelato_abc123",
        },
        prices: [{ currency_code: "brl", amount: 109 }],
        options: [
          { id: "optval_size_g", value: "G" },
          { id: "optval_color_black", value: "Preto" },
        ],
      },
    ],
  }
}

function createRequest(overrides: Partial<MedusaRequest> = {}) {
  return {
    query: {},
    queryConfig: {
      fields: ["id"],
    },
    filterableFields: {},
    params: {},
    scope: {
      resolve: jest.fn(),
    },
    ...overrides,
  } as MedusaRequest
}

function createResponse() {
  const jsonSpy = jest.fn()
  const response = {
    statusCode: 200,
    status: jest.fn(function status(code: number) {
      response.statusCode = code
      return response
    }),
    json: jest.fn(function json(body: unknown) {
      jsonSpy(body)
      return response
    }),
    jsonSpy,
  }

  return response as MedusaResponse & {
    statusCode: number
    status: jest.Mock
    json: jest.Mock
    jsonSpy: jest.Mock
  }
}

describe("catalog store contract", () => {
  it("forces the stable public field selection for the Store API", () => {
    const req = createRequest({
      queryConfig: undefined,
    })

    applyStoreCatalogQueryConfig(req as never)

    expect(req.query.fields).toBe(storeCatalogPublicFields.join(","))
  })

  it("GET /store/products exposes only the shopper-facing public contract", async () => {
    const product = createRawProduct()
    const graph = jest.fn(async () => ({
      data: [product],
      metadata: {
        count: 1,
        skip: 0,
        take: 20,
      },
    }))

    const req = createRequest({
      scope: {
        resolve: jest.fn((key) => {
          if (key === ContainerRegistrationKeys.QUERY) {
            return { graph }
          }

          return undefined
        }),
      },
    })
    const res = createResponse()

    applyStoreCatalogQueryConfig(req as never)
    storeCatalogResponseMiddleware(req, res, jest.fn())

    await listStoreProducts(req, res)

    expect(graph).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: "product",
        fields: [...storeCatalogPublicFields],
      }),
      expect.objectContaining({
        cache: {
          enable: true,
        },
      })
    )

    const body = res.jsonSpy.mock.calls[0][0]

    expect(body).toEqual({
      products: [
        {
          id: "prod_01",
          title: "Camiseta Essential",
          subtitle: "Malha premium",
          description: "Camiseta algodao penteado",
          handle: "camiseta-essential",
          thumbnail: PUBLIC_IMAGE_URL,
          images: [
            {
              id: "img_01",
              url: PUBLIC_IMAGE_URL,
            },
          ],
          options: [
            {
              id: "opt_size",
              title: "Tamanho",
              values: ["M", "G"],
            },
            {
              id: "opt_color",
              title: "Cor",
              values: ["Preto"],
            },
          ],
          variants: [
            {
              id: "variant_sellable",
              title: "Preto / M",
              sku: "TSHIRT-BLACK-M",
              is_sellable: true,
              price: {
                currency_code: "brl",
                amount: 99,
              },
              options: [
                {
                  name: "Tamanho",
                  value: "M",
                },
                {
                  name: "Cor",
                  value: "Preto",
                },
              ],
            },
          ],
        },
      ],
      count: 1,
      offset: 0,
      limit: 20,
    })
    expect(JSON.stringify(body)).not.toContain("gelato_")
  })

  it("GET /store/products/:id reuses the same public serializer", async () => {
    const product = createRawProduct()
    const graph = jest.fn(async () => ({
      data: [product],
    }))

    const req = createRequest({
      params: {
        id: "prod_01",
      },
      scope: {
        resolve: jest.fn((key) => {
          if (key === ContainerRegistrationKeys.QUERY) {
            return { graph }
          }

          return undefined
        }),
      },
    })
    const res = createResponse()

    applyStoreCatalogQueryConfig(req as never)
    storeCatalogResponseMiddleware(req, res, jest.fn())

    await retrieveStoreProduct(req, res)

    const body = res.jsonSpy.mock.calls[0][0]

    expect(body.product).toEqual(
      expect.objectContaining({
        id: "prod_01",
        title: "Camiseta Essential",
      })
    )
    expect(body.product.variants).toHaveLength(1)
    expect(body.product.variants[0]).toEqual(
      expect.objectContaining({
        id: "variant_sellable",
        is_sellable: true,
      })
    )
    expect(JSON.stringify(body)).not.toContain("gelato_")
  })

  it("registers only Store API middlewares for the standard Medusa catalog routes", () => {
    const storeMatchers = defaultMiddlewares.routes
      .filter((route) => route.methods?.includes("GET"))
      .map((route) => route.matcher)

    expect(storeMatchers).toContain("/store/products")
    expect(storeMatchers).toContain("/store/products/:id")
    expect(storeMatchers).not.toContain("/store/catalog")
  })
})
