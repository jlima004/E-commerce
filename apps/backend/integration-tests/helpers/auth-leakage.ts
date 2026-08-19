export const AUTH_TEST_HARNESS_FORBIDDEN = "AUTH_TEST_HARNESS_FORBIDDEN"

export const AUTH_LEAKAGE_SINKS = [
  "db_plaintext",
  "redis_keys_jobs",
  "logs",
  "sentry",
  "openapi",
  "fixtures_snapshots",
  "analytics",
  "persisted_provider_payload",
] as const

export const AUTH_CANARIES = {
  access: "cap_access_p14w0_synthetic_never_persist",
  refresh: "cap_refresh_p14w0_synthetic_never_persist",
  verification: "cap_verify_p14w0_synthetic_never_persist",
  reset: "cap_reset_p14w0_synthetic_never_persist",
  password: "pwd_p14w0_synthetic_never_persist",
  email: "auth_canary_p14w0_mailbox_never_persist",
} as const

export const AUTH_SAFE_SINK_KEYS = ["hash", "nonce", "key_version"] as const

export type AuthLeakageSinkName = (typeof AUTH_LEAKAGE_SINKS)[number]
export type AuthCanaryKind = keyof typeof AUTH_CANARIES

export type AuthPersistableMaterial = {
  hash: string
  nonce: string
  key_version: number
}

export type AuthLeakageSinkSnapshots = Partial<
  Record<AuthLeakageSinkName, unknown>
>

export type AuthLeakageCollector = {
  record(sink: AuthLeakageSinkName, snapshot: unknown): void
  snapshots(): AuthLeakageSinkSnapshots
  assertNoCanaries(): void
}

type AuthTestHarnessError = Error & { code: string }

function assertAuthTestHarnessAllowed(): void {
  if (process.env.NODE_ENV !== "test") {
    const error = new Error(AUTH_TEST_HARNESS_FORBIDDEN) as AuthTestHarnessError
    error.code = AUTH_TEST_HARNESS_FORBIDDEN
    throw error
  }
}

assertAuthTestHarnessAllowed()

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

function findCanaries(value: unknown): string[] {
  const serialized = serializeSnapshot(value)
  return Object.values(AUTH_CANARIES).filter((canary) =>
    serialized.includes(canary)
  )
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function buildSafeAuthSink(
  material: AuthPersistableMaterial
): AuthPersistableMaterial {
  return {
    hash: material.hash,
    nonce: material.nonce,
    key_version: material.key_version,
  }
}

export function assertAuthSinksHaveNoCanaries(
  snapshots: AuthLeakageSinkSnapshots | unknown
): void {
  const entries = isPlainObject(snapshots)
    ? Object.entries(snapshots)
    : [["snapshot", snapshots] as const]

  for (const [sink, snapshot] of entries) {
    const leaked = findCanaries(snapshot)
    if (leaked.length > 0) {
      throw new Error(`AUTH_LEAKAGE_CANARY_DETECTED:${sink}`)
    }
  }
}

export function assertSafeAuthSink(snapshot: unknown): void {
  assertAuthSinksHaveNoCanaries({ db_plaintext: snapshot })

  if (!isPlainObject(snapshot)) {
    throw new Error("AUTH_LEAKAGE_UNSAFE_SINK")
  }

  const keys = Object.keys(snapshot).sort()
  const allowed = [...AUTH_SAFE_SINK_KEYS].sort()
  const hasOnlySafeKeys =
    keys.length === allowed.length &&
    keys.every((key, index) => key === allowed[index])

  if (!hasOnlySafeKeys) {
    throw new Error("AUTH_LEAKAGE_UNSAFE_SINK")
  }
}

export function createAuthLeakageCollector(): AuthLeakageCollector {
  const recorded: AuthLeakageSinkSnapshots = {}

  return {
    record(sink: AuthLeakageSinkName, snapshot: unknown): void {
      recorded[sink] = snapshot
    },
    snapshots(): AuthLeakageSinkSnapshots {
      return { ...recorded }
    },
    assertNoCanaries(): void {
      assertAuthSinksHaveNoCanaries(recorded)
    },
  }
}
