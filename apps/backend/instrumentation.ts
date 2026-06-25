import * as Sentry from "@sentry/node"
import type {
  Breadcrumb as SentryBreadcrumb,
  Event as SentryEvent,
} from "@sentry/node"
import { env, type AppEnv } from "./src/config/env"
import {
  scrubBreadcrumb,
  scrubEvent,
  type SentryBreadcrumbLike,
  type SentryEventLike,
} from "./src/observability/sentry-scrub"

const SERVICE_NAME = "@dtc/backend"

type ScopeLike = {
  setTag(key: string, value: string): void
}

export function applySentryInitialScope(
  scope: ScopeLike,
  currentEnv: Pick<AppEnv, "WORKER_MODE">
): ScopeLike {
  scope.setTag("service", SERVICE_NAME)
  scope.setTag("process_role", currentEnv.WORKER_MODE)
  return scope
}

export function createSentryInitOptions(
  currentEnv: AppEnv
) {
  return {
    dsn: currentEnv.SENTRY_DSN,
    enabled: Boolean(currentEnv.SENTRY_DSN),
    environment: currentEnv.NODE_ENV,
    release: currentEnv.APP_VERSION,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    beforeSend(event) {
      return scrubEvent(event as SentryEventLike) as SentryEvent | null
    },
    beforeBreadcrumb(breadcrumb) {
      return scrubBreadcrumb(
        breadcrumb as SentryBreadcrumbLike
      ) as SentryBreadcrumb | null
    },
    initialScope(scope) {
      return applySentryInitialScope(scope as ScopeLike, currentEnv)
    },
  }
}

export function register() {
  Sentry.init(createSentryInitOptions(env) as Parameters<typeof Sentry.init>[0])
}
