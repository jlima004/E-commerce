import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  ContainerRegistrationKeys,
  MedusaError,
  remoteQueryObjectFromString,
} from "@medusajs/framework/utils"
import {
  assertPublicTrackingLookupResponseAllowlisted,
  serializePublicTrackingLookupResponse,
  type TrackingLookupFulfillmentSnapshot,
  type TrackingLookupOrderSnapshot,
} from "../serializers"
import { GELATO_FULFILLMENT_MODULE } from "../../../../modules/gelato-fulfillment"
import {
  buildTrackingAccessTokenLastUsedPatch,
  buildTrackingLookupInvalidTokenResponseBody,
  rejectTrackingTokenInRequestUrl,
  resolveTrackingLookupContext,
  TrackingLookupInvalidTokenError,
} from "../../../../modules/tracking-access-token/lookup"
import { parseTrackingLookupRequestBody } from "../../../../modules/tracking-access-token/lookup-body"
import { TRACKING_ACCESS_TOKEN_MODULE } from "../../../../modules/tracking-access-token"
import type { TrackingAccessTokenRecord } from "../../../../modules/tracking-access-token/types"
import type { GelatoFulfillmentRecord } from "../../../../modules/gelato-fulfillment/types"

const ORDER_LOOKUP_FIELDS = [
  "id",
  "display_id",
  "updated_at",
  "metadata",
  "items.title",
  "items.product_title",
] as const

type TrackingAccessTokenModuleLike = {
  listTrackingAccessTokens?: (
    filters?: Record<string, unknown>
  ) => Promise<TrackingAccessTokenRecord[]>
  updateTrackingAccessTokens?: (
    data: Record<string, unknown> | Array<Record<string, unknown>>
  ) => Promise<TrackingAccessTokenRecord[] | TrackingAccessTokenRecord>
}

type GelatoFulfillmentModuleLike = {
  listGelatoFulfillments?: (
    filters?: Record<string, unknown>
  ) => Promise<GelatoFulfillmentRecord[]>
}

async function fetchOrderSnapshot(
  remoteQuery: (query: unknown) => Promise<unknown>,
  orderId: string
): Promise<TrackingLookupOrderSnapshot | null> {
  const queryObject = remoteQueryObjectFromString({
    entryPoint: "order",
    variables: {
      filters: {
        id: orderId,
      },
    },
    fields: [...ORDER_LOOKUP_FIELDS],
  })

  const result = (await remoteQuery(queryObject)) as TrackingLookupOrderSnapshot[]
  return result[0] ?? null
}

async function fetchFulfillmentSnapshot(
  gelatoModule: GelatoFulfillmentModuleLike,
  fulfillmentId: string
): Promise<TrackingLookupFulfillmentSnapshot | null> {
  const rows =
    (await gelatoModule.listGelatoFulfillments?.({
      id: fulfillmentId,
    })) ?? []

  const fulfillment = rows[0]

  if (!fulfillment) {
    return null
  }

  return {
    status: fulfillment.status,
    tracking_summary: fulfillment.tracking_summary,
    request_summary: fulfillment.request_summary
      ? {
          item_count: fulfillment.request_summary.item_count,
        }
      : null,
    updated_at: fulfillment.updated_at,
  }
}

function respondTrackingLookupInvalidToken(res: MedusaResponse): void {
  res.status(401).json(buildTrackingLookupInvalidTokenResponseBody())
}

export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  try {
    rejectTrackingTokenInRequestUrl({
      query: req.query as Record<string, unknown>,
      params: req.params as Record<string, unknown>,
    })
  } catch {
    respondTrackingLookupInvalidToken(res)
    return
  }

  let candidateToken: string

  try {
    ;({ token: candidateToken } = parseTrackingLookupRequestBody(req.body))
  } catch (error) {
    if (error instanceof MedusaError) {
      throw error
    }

    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Requisicao de rastreio invalida."
    )
  }

  const trackingModule = req.scope.resolve(
    TRACKING_ACCESS_TOKEN_MODULE
  ) as TrackingAccessTokenModuleLike

  let tokenRecord: TrackingAccessTokenRecord

  try {
    tokenRecord = await resolveTrackingLookupContext({
      candidateToken,
      listByHash: async (tokenHash) => {
        const rows =
          (await trackingModule.listTrackingAccessTokens?.({
            token_hash: tokenHash,
          })) ?? []

        return rows[0] ?? null
      },
      updateLastUsed: async (recordId) => {
        await trackingModule.updateTrackingAccessTokens?.({
          id: recordId,
          ...buildTrackingAccessTokenLastUsedPatch(),
        })
      },
    })
  } catch (error) {
    if (error instanceof TrackingLookupInvalidTokenError) {
      respondTrackingLookupInvalidToken(res)
      return
    }

    respondTrackingLookupInvalidToken(res)
    return
  }

  const gelatoModule = req.scope.resolve(
    GELATO_FULFILLMENT_MODULE
  ) as GelatoFulfillmentModuleLike
  const remoteQuery = req.scope.resolve(ContainerRegistrationKeys.REMOTE_QUERY)

  const [order, fulfillment] = await Promise.all([
    fetchOrderSnapshot(remoteQuery, tokenRecord.order_id),
    fetchFulfillmentSnapshot(gelatoModule, tokenRecord.gelato_fulfillment_id),
  ])

  const tracking = serializePublicTrackingLookupResponse({
    order,
    fulfillment,
  })

  assertPublicTrackingLookupResponseAllowlisted(tracking)

  res.status(200).json({
    tracking,
  })
}
