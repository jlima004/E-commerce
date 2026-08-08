/**
 * Store surface fail-closed guard — RED stub (Task 2).
 * Real enforcement lands in the GREEN commit.
 */

import type {
  MedusaNextFunction,
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import type { StoreSurfaceEntry } from "./manifest"

export type StoreSurfaceDecision =
  | {
      action: "deny"
      reason: string
      code: string
    }
  | {
      action: "allow"
      entry: StoreSurfaceEntry
      mode: "preserve_legacy" | "m1_enabled"
    }
  | {
      action: "options_preflight"
    }

export function normalizeStoreRequestPath(_raw: string): string | null {
  return null
}

export function matchStorePathToTemplate(
  _path: string,
  _templates: readonly string[]
): string | null {
  return null
}

export function decideStoreSurfaceAccess(
  _method: string,
  _path: string,
  _options?: {
    origin?: string
    accessControlRequestMethod?: string
  }
): StoreSurfaceDecision {
  return {
    action: "deny",
    reason: "STUB",
    code: "STORE_SURFACE_DENIED",
  }
}

export function createStoreSurfaceGuardMiddleware() {
  return function storeSurfaceGuardMiddleware(
    _req: MedusaRequest,
    _res: MedusaResponse,
    next: MedusaNextFunction
  ): void {
    next()
  }
}
