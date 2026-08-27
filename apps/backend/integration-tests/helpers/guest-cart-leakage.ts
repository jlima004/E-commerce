export const GUEST_CART_TEST_HARNESS_FORBIDDEN =
  "GUEST_CART_TEST_HARNESS_FORBIDDEN"

export const GUEST_CART_LEAKAGE_SINKS = [
  "db_plaintext",
  "redis_keys_jobs",
  "logs",
  "sentry",
  "openapi",
  "fixtures_snapshots",
  "analytics",
  "persisted_provider_payload",
] as const

export const GUEST_CART_CANARIES = {
  token: "canary_guest_cart_token_p15w0_never_persist_plaintext_val",
  session: "canary_guest_cart_session_p15w0_never_persist",
  secret: "canary_guest_cart_secret_p15w0_never_persist",
} as const

export const PHASE16_GUEST_CAPABILITY_CANARY =
  "p16w11_cap_canary_not_a_token_zz9q_never_persist"
export const PHASE16_CUSTOMER_JWT_CANARY =
  "p16w11_jwt_canary_not_a_bearer_ww7k_never_persist"
export const PHASE16_RAW_IDEMPOTENCY_KEY_CANARY =
  "p16w11_idem_canary_not_a_uuid_mm3n_never_persist"

export const PHASE16_LEAKAGE_CANARIES = [
  PHASE16_GUEST_CAPABILITY_CANARY,
  PHASE16_CUSTOMER_JWT_CANARY,
  PHASE16_RAW_IDEMPOTENCY_KEY_CANARY,
] as const

export type Phase16SecretClass =
  | "guest_capability"
  | "customer_jwt"
  | "raw_idempotency_key"

const PHASE16_CANARY_SECRET_CLASS: Record<string, Phase16SecretClass> = {
  [PHASE16_GUEST_CAPABILITY_CANARY]: "guest_capability",
  [PHASE16_CUSTOMER_JWT_CANARY]: "customer_jwt",
  [PHASE16_RAW_IDEMPOTENCY_KEY_CANARY]: "raw_idempotency_key",
}

const LEGACY_CANARY_SECRET_CLASS: Record<string, string> = {
  [GUEST_CART_CANARIES.token]: "guest_capability",
  [GUEST_CART_CANARIES.session]: "guest_session",
  [GUEST_CART_CANARIES.secret]: "bff_secret",
}

export const GUEST_CART_SAFE_SINK_KEYS = [
  "id",
  "cart_id",
  "token_hash",
  "status",
  "expires_at",
  "created_at",
  "updated_at",
  "last_used_at",
  "revoked_at",
  "consumed_at",
  "metadata",
] as const

export type GuestCartLeakageSinkName =
  (typeof GUEST_CART_LEAKAGE_SINKS)[number]
export type GuestCartCanaryKind = keyof typeof GUEST_CART_CANARIES

export type GuestCartLeakageSinkSnapshots = Partial<
  Record<GuestCartLeakageSinkName, unknown>
>

export type GuestCartLeakageCollector = {
  record(sink: GuestCartLeakageSinkName, snapshot: unknown): void
  snapshots(): GuestCartLeakageSinkSnapshots
  assertNoCanaries(extraCanaries?: string[]): void
}

type GuestCartTestHarnessError = Error & { code: string }

type CanaryLeakMatch = {
  canary: string
  secretClass: string
}

function assertGuestCartTestHarnessAllowed(): void {
  if (process.env.NODE_ENV !== "test") {
    const error = new Error(
      GUEST_CART_TEST_HARNESS_FORBIDDEN
    ) as GuestCartTestHarnessError
    error.code = GUEST_CART_TEST_HARNESS_FORBIDDEN
    throw error
  }
}

assertGuestCartTestHarnessAllowed()

function serializeSnapshot(value: unknown): string {
  if (typeof value === "string") {
    return value
  }

  try {
    return JSON.stringify(value) ?? ""
  } catch {
    return String(value)
  }
}

function secretClassForCanary(canary: string): string {
  return (
    PHASE16_CANARY_SECRET_CLASS[canary] ??
    LEGACY_CANARY_SECRET_CLASS[canary] ??
    "unknown_secret"
  )
}

function defaultCanarySet(extraCanaries: string[] = []): string[] {
  return [
    ...Object.values(GUEST_CART_CANARIES),
    ...PHASE16_LEAKAGE_CANARIES,
    ...extraCanaries,
  ]
}

function findCanaryLeaks(
  value: unknown,
  extraCanaries: string[] = []
): CanaryLeakMatch[] {
  const serialized = serializeSnapshot(value)
  const leaks: CanaryLeakMatch[] = []
  for (const canary of defaultCanarySet(extraCanaries)) {
    if (serialized.includes(canary)) {
      leaks.push({ canary, secretClass: secretClassForCanary(canary) })
    }
  }
  return leaks
}

function encodingVariants(value: string): string[] {
  const buffer = Buffer.from(value, "utf8")
  return [
    value,
    buffer.toString("base64"),
    buffer.toString("base64url"),
    buffer.toString("hex"),
    encodeURIComponent(value),
  ]
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function throwCanaryLeakDetected(
  sink: string,
  secretClass: string
): never {
  throw new Error(
    `GUEST_CART_LEAKAGE_CANARY_DETECTED:${sink} sink=${sink} secret_class=${secretClass}`
  )
}

export function assertGuestCartSinksHaveNoCanaries(
  snapshots: GuestCartLeakageSinkSnapshots | unknown,
  extraCanaries: string[] = []
): void {
  assertGuestCartTestHarnessAllowed()
  const entries = isPlainObject(snapshots)
    ? Object.entries(snapshots)
    : [["snapshot", snapshots] as const]

  for (const [sink, snapshot] of entries) {
    const leaked = findCanaryLeaks(snapshot, extraCanaries)
    if (leaked.length > 0) {
      throwCanaryLeakDetected(sink, leaked[0].secretClass)
    }
  }
}

export function assertNoSecretLeak(
  snapshots: GuestCartLeakageSinkSnapshots | unknown,
  extraCanaries: string[] = []
): void {
  assertGuestCartSinksHaveNoCanaries(snapshots, extraCanaries)
}

export function assertPublicIdentifiersDoNotEncodeSecrets(
  reviewRef: string | null | undefined,
  etag: string | null | undefined,
  requestFingerprint: string | null | undefined,
  extraCanaries: string[] = []
): void {
  assertGuestCartTestHarnessAllowed()
  const identifiers = {
    reviewRef: reviewRef ?? null,
    etag: etag ?? null,
    requestFingerprint: requestFingerprint ?? null,
  }
  const canaries = defaultCanarySet(extraCanaries)

  for (const canary of canaries) {
    const variants = encodingVariants(canary)
    for (const [name, value] of Object.entries(identifiers)) {
      if (value == null || value === "") continue
      for (const variant of variants) {
        if (variant.length < 4) continue
        if (String(value).includes(variant)) {
          throwCanaryLeakDetected(
            "fixtures_snapshots",
            secretClassForCanary(canary)
          )
        }
      }
      void name
    }
  }
}

export function assertSafeGuestCartSink(snapshot: unknown): void {
  assertGuestCartTestHarnessAllowed()
  assertGuestCartSinksHaveNoCanaries({ db_plaintext: snapshot })

  if (!isPlainObject(snapshot)) {
    throw new Error("GUEST_CART_LEAKAGE_UNSAFE_SINK")
  }

  const allowedSet = new Set<string>(GUEST_CART_SAFE_SINK_KEYS)
  const keys = Object.keys(snapshot)
  const hasDisallowedKey = keys.some((key) => !allowedSet.has(key))

  if (hasDisallowedKey) {
    throw new Error("GUEST_CART_LEAKAGE_UNSAFE_SINK")
  }
}

export function createGuestCartLeakageCollector(): GuestCartLeakageCollector {
  assertGuestCartTestHarnessAllowed()
  const recorded: GuestCartLeakageSinkSnapshots = {}

  return {
    record(sink: GuestCartLeakageSinkName, snapshot: unknown): void {
      recorded[sink] = snapshot
    },
    snapshots(): GuestCartLeakageSinkSnapshots {
      return { ...recorded }
    },
    assertNoCanaries(extraCanaries: string[] = []): void {
      assertGuestCartSinksHaveNoCanaries(recorded, extraCanaries)
    },
  }
}
