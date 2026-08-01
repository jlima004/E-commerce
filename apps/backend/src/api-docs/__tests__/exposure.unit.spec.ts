import {
  CANONICAL_GELATO_WEBHOOK_AUTH_HEADER_NAME,
  canExposeApiDocs,
  matchesCanonicalGelatoWebhookAuthHeader,
  resolveApiDocsFlagDefaults,
  type ApiDocsFlags,
} from "../runtime/exposure"

const allEnabled: ApiDocsFlags = {
  API_DOCS_ENABLED: true,
  API_DOCS_UI_ENABLED: true,
  API_DOCS_PUBLIC_ENABLED: true,
  API_DOCS_INTERNAL_ENABLED: true,
}

const userActor = {
  authenticated: true as const,
  actor_type: "user",
  actor_id: "user_123",
  auth_via: "session" as const,
}

describe("resolveApiDocsFlagDefaults", () => {
  it("returns development defaults", () => {
    expect(resolveApiDocsFlagDefaults("development")).toEqual({
      API_DOCS_ENABLED: true,
      API_DOCS_UI_ENABLED: true,
      API_DOCS_PUBLIC_ENABLED: true,
      API_DOCS_INTERNAL_ENABLED: true,
    })
  })

  it("returns test defaults with UI disabled", () => {
    expect(resolveApiDocsFlagDefaults("test")).toEqual({
      API_DOCS_ENABLED: true,
      API_DOCS_UI_ENABLED: false,
      API_DOCS_PUBLIC_ENABLED: true,
      API_DOCS_INTERNAL_ENABLED: true,
    })
  })

  it("returns production fail-closed defaults", () => {
    expect(resolveApiDocsFlagDefaults("production")).toEqual({
      API_DOCS_ENABLED: false,
      API_DOCS_UI_ENABLED: false,
      API_DOCS_PUBLIC_ENABLED: false,
      API_DOCS_INTERNAL_ENABLED: false,
    })
  })

  it("fails closed for unknown NODE_ENV values", () => {
    expect(resolveApiDocsFlagDefaults("staging")).toEqual({
      API_DOCS_ENABLED: false,
      API_DOCS_UI_ENABLED: false,
      API_DOCS_PUBLIC_ENABLED: false,
      API_DOCS_INTERNAL_ENABLED: false,
    })
  })
})

describe("canExposeApiDocs — store surface", () => {
  it("exposes when enabled and public (anonymous OK)", () => {
    expect(canExposeApiDocs(allEnabled, "store", undefined)).toBe(true)
    expect(
      canExposeApiDocs(allEnabled, "store", { authenticated: false })
    ).toBe(true)
  })

  it("hides when master is disabled", () => {
    expect(
      canExposeApiDocs(
        { ...allEnabled, API_DOCS_ENABLED: false },
        "store",
        undefined
      )
    ).toBe(false)
  })

  it("hides when public is disabled", () => {
    expect(
      canExposeApiDocs(
        { ...allEnabled, API_DOCS_PUBLIC_ENABLED: false },
        "store",
        undefined
      )
    ).toBe(false)
  })

  it("hides under production defaults", () => {
    expect(
      canExposeApiDocs(
        resolveApiDocsFlagDefaults("production"),
        "store",
        undefined
      )
    ).toBe(false)
  })

  it("exposes for anonymous while enabled", () => {
    expect(canExposeApiDocs(allEnabled, "store", null)).toBe(true)
  })

  it("ignores actor for store (customer still exposed when public)", () => {
    expect(
      canExposeApiDocs(allEnabled, "store", {
        authenticated: true,
        actor_type: "customer",
      })
    ).toBe(true)
  })
})

describe("canExposeApiDocs — admin and webhooks surfaces", () => {
  for (const surface of ["admin", "webhooks"] as const) {
    describe(surface, () => {
      it("exposes when enabled+internal with user actor (session)", () => {
        expect(canExposeApiDocs(allEnabled, surface, userActor)).toBe(true)
      })

      it("exposes when enabled+internal with user actor (bearer)", () => {
        expect(
          canExposeApiDocs(allEnabled, surface, {
            authenticated: true,
            actor_type: "user",
            actor_id: "user_123",
            auth_via: "bearer",
          })
        ).toBe(true)
      })

      it("hides for anonymous", () => {
        expect(canExposeApiDocs(allEnabled, surface, undefined)).toBe(false)
        expect(
          canExposeApiDocs(allEnabled, surface, { authenticated: false })
        ).toBe(false)
      })

      it("hides for API key actor", () => {
        expect(
          canExposeApiDocs(allEnabled, surface, {
            authenticated: true,
            actor_type: "api_key",
          })
        ).toBe(false)
      })

      it("hides for invalid or incomplete auth", () => {
        expect(
          canExposeApiDocs(allEnabled, surface, {
            authenticated: true,
          })
        ).toBe(false)
        expect(
          canExposeApiDocs(allEnabled, surface, {
            authenticated: true,
            actor_type: "",
          })
        ).toBe(false)
        expect(
          canExposeApiDocs(allEnabled, surface, {
            authenticated: true,
            actor_type: null,
          })
        ).toBe(false)
      })

      it("hides for authenticated user with missing or empty actor_id", () => {
        expect(
          canExposeApiDocs(allEnabled, surface, {
            authenticated: true,
            actor_type: "user",
            auth_via: "session",
          })
        ).toBe(false)
        expect(
          canExposeApiDocs(allEnabled, surface, {
            authenticated: true,
            actor_type: "user",
            actor_id: null,
            auth_via: "bearer",
          })
        ).toBe(false)
        expect(
          canExposeApiDocs(allEnabled, surface, {
            authenticated: true,
            actor_type: "user",
            actor_id: "",
            auth_via: "session",
          })
        ).toBe(false)
        expect(
          canExposeApiDocs(allEnabled, surface, {
            authenticated: true,
            actor_type: "user",
            actor_id: "   ",
            auth_via: "bearer",
          })
        ).toBe(false)
      })

      it("hides when master is disabled", () => {
        expect(
          canExposeApiDocs(
            { ...allEnabled, API_DOCS_ENABLED: false },
            surface,
            userActor
          )
        ).toBe(false)
      })

      it("hides when internal is disabled", () => {
        expect(
          canExposeApiDocs(
            { ...allEnabled, API_DOCS_INTERNAL_ENABLED: false },
            surface,
            userActor
          )
        ).toBe(false)
      })

      it("hides under production defaults", () => {
        expect(
          canExposeApiDocs(
            resolveApiDocsFlagDefaults("production"),
            surface,
            userActor
          )
        ).toBe(false)
      })

      it("hides for customer actor", () => {
        expect(
          canExposeApiDocs(allEnabled, surface, {
            authenticated: true,
            actor_type: "customer",
          })
        ).toBe(false)
      })
    })
  }
})

describe("canExposeApiDocs — ui surface", () => {
  it("exposes when master and UI are enabled (auth irrelevant)", () => {
    expect(canExposeApiDocs(allEnabled, "ui", undefined)).toBe(true)
    expect(
      canExposeApiDocs(allEnabled, "ui", {
        authenticated: true,
        actor_type: "customer",
      })
    ).toBe(true)
  })

  it("hides when master is disabled", () => {
    expect(
      canExposeApiDocs(
        { ...allEnabled, API_DOCS_ENABLED: false },
        "ui",
        undefined
      )
    ).toBe(false)
  })

  it("hides when UI is disabled", () => {
    expect(
      canExposeApiDocs(
        { ...allEnabled, API_DOCS_UI_ENABLED: false },
        "ui",
        undefined
      )
    ).toBe(false)
  })

  it("hides under test defaults where UI is false", () => {
    expect(
      canExposeApiDocs(resolveApiDocsFlagDefaults("test"), "ui", undefined)
    ).toBe(false)
  })
})

describe("canExposeApiDocs — master prevails", () => {
  it("hides every surface when master is off even if subordinates are on", () => {
    const flags: ApiDocsFlags = {
      API_DOCS_ENABLED: false,
      API_DOCS_UI_ENABLED: true,
      API_DOCS_PUBLIC_ENABLED: true,
      API_DOCS_INTERNAL_ENABLED: true,
    }

    expect(canExposeApiDocs(flags, "ui", undefined)).toBe(false)
    expect(canExposeApiDocs(flags, "store", undefined)).toBe(false)
    expect(canExposeApiDocs(flags, "admin", userActor)).toBe(false)
    expect(canExposeApiDocs(flags, "webhooks", userActor)).toBe(false)
  })
})

describe("matchesCanonicalGelatoWebhookAuthHeader", () => {
  it("accepts the committed canonical header name", () => {
    expect(
      matchesCanonicalGelatoWebhookAuthHeader(
        CANONICAL_GELATO_WEBHOOK_AUTH_HEADER_NAME
      )
    ).toBe(true)
  })

  it("accepts canonical header with different casing and surrounding whitespace", () => {
    expect(
      matchesCanonicalGelatoWebhookAuthHeader("X-GELATO-WEBHOOK-SECRET")
    ).toBe(true)
    expect(
      matchesCanonicalGelatoWebhookAuthHeader("X-Gelato-Webhook-Secret")
    ).toBe(true)
    expect(
      matchesCanonicalGelatoWebhookAuthHeader("  x-gelato-webhook-secret  ")
    ).toBe(true)
  })

  it("rejects custom header overrides", () => {
    expect(
      matchesCanonicalGelatoWebhookAuthHeader("x-custom-gelato-secret")
    ).toBe(false)
    expect(matchesCanonicalGelatoWebhookAuthHeader("Authorization")).toBe(
      false
    )
  })

  it("rejects empty, whitespace-only, and non-string values", () => {
    expect(matchesCanonicalGelatoWebhookAuthHeader("")).toBe(false)
    expect(matchesCanonicalGelatoWebhookAuthHeader("   ")).toBe(false)
    expect(matchesCanonicalGelatoWebhookAuthHeader(null)).toBe(false)
    expect(matchesCanonicalGelatoWebhookAuthHeader(undefined)).toBe(false)
  })
})
