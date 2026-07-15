export type RuntimeVersionSource =
  | "heroku_build_commit"
  | "heroku_slug_commit"
  | "app_version"
  | "development_default"

export type ResolvedRuntimeVersion = {
  value: string
  source: RuntimeVersionSource
}

const INVALID_LITERAL_VALUES = new Set(["null", "undefined"])
const PRODUCTION_PLACEHOLDERS = new Set(["dev", "unknown"])
const HEROKU_COMMIT_PATTERN = /^[0-9a-f]{7,40}$/i

const MISSING_RUNTIME_VERSION_MESSAGE =
  "Missing required runtime version: HEROKU_BUILD_COMMIT, HEROKU_SLUG_COMMIT or APP_VERSION"

function normalizeCandidate(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined
  }

  const normalized = value.trim()
  if (!normalized || INVALID_LITERAL_VALUES.has(normalized.toLowerCase())) {
    return undefined
  }

  return normalized
}

function normalizeHerokuCommit(value: string | undefined): string | undefined {
  const normalized = normalizeCandidate(value)

  if (!normalized || !HEROKU_COMMIT_PATTERN.test(normalized)) {
    return undefined
  }

  return normalized
}

function normalizeAppVersion(
  value: string | undefined,
  production: boolean
): string | undefined {
  const normalized = normalizeCandidate(value)

  if (
    !normalized ||
    (production && PRODUCTION_PLACEHOLDERS.has(normalized.toLowerCase()))
  ) {
    return undefined
  }

  return normalized
}

export function resolveRuntimeVersion(
  input: Record<string, string | undefined>,
  production: boolean
): ResolvedRuntimeVersion {
  const buildCommit = normalizeHerokuCommit(input.HEROKU_BUILD_COMMIT)
  if (buildCommit) {
    return {
      value: buildCommit,
      source: "heroku_build_commit",
    }
  }

  const slugCommit = normalizeHerokuCommit(input.HEROKU_SLUG_COMMIT)
  if (slugCommit) {
    return {
      value: slugCommit,
      source: "heroku_slug_commit",
    }
  }

  const appVersion = normalizeAppVersion(input.APP_VERSION, production)
  if (appVersion) {
    return {
      value: appVersion,
      source: "app_version",
    }
  }

  if (!production) {
    return {
      value: "dev",
      source: "development_default",
    }
  }

  throw new Error(MISSING_RUNTIME_VERSION_MESSAGE)
}
