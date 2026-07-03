import { createHmac } from "crypto"
import {
  assertActiveTrackingAccessToken,
  buildTrackingAccessTokenLastUsedUpdate,
  compareTrackingAccessTokenHash,
  hashTrackingAccessToken,
  resolveTrackingTokenPepper,
  verifyTrackingAccessTokenCandidate,
} from "./service"
import type { TrackingAccessTokenRecord } from "./types"

export const TRACKING_LOOKUP_INVALID_TOKEN_CODE = "tracking_lookup_unavailable"

export const TRACKING_LOOKUP_INVALID_TOKEN_MESSAGE =
  "Nao foi possivel localizar o rastreio com este token."

const DUMMY_TRACKING_TOKEN_HASH = createHmac("sha256", "tracking-lookup-dummy-pepper")
  .update("tracking-lookup-dummy-token")
  .digest("hex")

export class TrackingLookupInvalidTokenError extends Error {
  readonly code = TRACKING_LOOKUP_INVALID_TOKEN_CODE

  constructor() {
    super(TRACKING_LOOKUP_INVALID_TOKEN_MESSAGE)
    this.name = "TrackingLookupInvalidTokenError"
  }
}

export function throwTrackingLookupInvalidTokenError(): never {
  throw new TrackingLookupInvalidTokenError()
}

function performDummyTrackingTokenHashComparison(candidateHash: string): void {
  compareTrackingAccessTokenHash(DUMMY_TRACKING_TOKEN_HASH, candidateHash)
}

export type LookupTrackingAccessTokenDeps = {
  pepper: string
  listByHash: (tokenHash: string) => Promise<TrackingAccessTokenRecord | null>
  now?: Date
}

export async function lookupTrackingAccessTokenByCandidate(
  candidateToken: string,
  deps: LookupTrackingAccessTokenDeps
): Promise<TrackingAccessTokenRecord> {
  const now = deps.now ?? new Date()
  let candidateHash: string

  try {
    candidateHash = hashTrackingAccessToken(candidateToken, deps.pepper)
  } catch {
    performDummyTrackingTokenHashComparison(DUMMY_TRACKING_TOKEN_HASH)
    throwTrackingLookupInvalidTokenError()
  }

  const record = await deps.listByHash(candidateHash)

  if (!record) {
    performDummyTrackingTokenHashComparison(candidateHash)
    throwTrackingLookupInvalidTokenError()
  }

  try {
    assertActiveTrackingAccessToken(record, now)
  } catch {
    compareTrackingAccessTokenHash(record.token_hash, candidateHash)
    throwTrackingLookupInvalidTokenError()
  }

  const verified = verifyTrackingAccessTokenCandidate(
    record,
    candidateToken,
    deps.pepper,
    now
  )

  if (!verified) {
    compareTrackingAccessTokenHash(record.token_hash, candidateHash)
    throwTrackingLookupInvalidTokenError()
  }

  return record
}

export type ResolveTrackingLookupContextInput = {
  candidateToken: string
  env?: Record<string, string | undefined>
  listByHash: (tokenHash: string) => Promise<TrackingAccessTokenRecord | null>
  updateLastUsed: (recordId: string) => Promise<void>
  now?: Date
}

export async function resolveTrackingLookupContext(
  input: ResolveTrackingLookupContextInput
): Promise<TrackingAccessTokenRecord> {
  const pepper = resolveTrackingTokenPepper(input.env)

  const record = await lookupTrackingAccessTokenByCandidate(input.candidateToken, {
    pepper,
    listByHash: input.listByHash,
    now: input.now,
  })

  await input.updateLastUsed(record.id)

  return record
}

export function buildTrackingAccessTokenLastUsedPatch(): ReturnType<
  typeof buildTrackingAccessTokenLastUsedUpdate
> {
  return buildTrackingAccessTokenLastUsedUpdate()
}

export function rejectTrackingTokenInRequestUrl(input: {
  query?: Record<string, unknown> | null
  params?: Record<string, unknown> | null
}): void {
  const sources = [input.query ?? {}, input.params ?? {}]

  for (const source of sources) {
    for (const key of Object.keys(source)) {
      const normalized = key.trim().toLowerCase()

      if (normalized === "token" || normalized === "tracking_token") {
        throw new TrackingLookupInvalidTokenError()
      }
    }
  }
}

export function buildTrackingLookupInvalidTokenResponseBody(): {
  type: string
  code: string
  message: string
} {
  return {
    type: "not_allowed",
    code: TRACKING_LOOKUP_INVALID_TOKEN_CODE,
    message: TRACKING_LOOKUP_INVALID_TOKEN_MESSAGE,
  }
}

export function buildTrackingLookupRateLimitedResponseBody(): ReturnType<
  typeof buildTrackingLookupInvalidTokenResponseBody
> {
  return buildTrackingLookupInvalidTokenResponseBody()
}

export function createStoreTrackingLookupGuardMiddleware() {
  return function storeTrackingLookupGuardMiddleware(
    req: {
      query?: Record<string, unknown>
      params?: Record<string, unknown>
    },
    res: {
      status: (code: number) => { json: (body: unknown) => void }
    },
    next: () => void
  ): void {
    try {
      rejectTrackingTokenInRequestUrl({
        query: req.query ?? {},
        params: req.params ?? {},
      })
      next()
    } catch {
      res.status(401).json(buildTrackingLookupInvalidTokenResponseBody())
    }
  }
}