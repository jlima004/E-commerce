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

function findCanaries(
  value: unknown,
  extraCanaries: string[] = []
): string[] {
  const serialized = serializeSnapshot(value)
  const allCanaries = [
    ...Object.values(GUEST_CART_CANARIES),
    ...extraCanaries,
  ]
  return allCanaries.filter((canary) => serialized.includes(canary))
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
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
    const leaked = findCanaries(snapshot, extraCanaries)
    if (leaked.length > 0) {
      throw new Error(`GUEST_CART_LEAKAGE_CANARY_DETECTED:${sink}`)
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
