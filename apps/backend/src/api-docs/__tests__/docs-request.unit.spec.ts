import type { MedusaRequest } from "@medusajs/framework/http"
import { mapAuthContextToApiDocsActor } from "../../api/openapi/_shared/docs-request"

function requestWithAuth(authContext: unknown): MedusaRequest {
  return { auth_context: authContext } as unknown as MedusaRequest
}

describe("mapAuthContextToApiDocsActor", () => {
  it("maps user actor with actor_id to authenticated", () => {
    expect(
      mapAuthContextToApiDocsActor(
        requestWithAuth({ actor_type: "user", actor_id: "user_123" })
      )
    ).toEqual({
      authenticated: true,
      actor_type: "user",
      actor_id: "user_123",
    })
  })

  it("maps api-key actor to unauthenticated", () => {
    expect(
      mapAuthContextToApiDocsActor(
        requestWithAuth({ actor_type: "api_key", actor_id: "apk_123" })
      )
    ).toEqual({ authenticated: false })
  })

  it("maps missing auth context to unauthenticated", () => {
    expect(mapAuthContextToApiDocsActor(requestWithAuth(undefined))).toEqual({
      authenticated: false,
    })
    expect(mapAuthContextToApiDocsActor({} as MedusaRequest)).toEqual({
      authenticated: false,
    })
  })

  it("maps empty actor_id to unauthenticated", () => {
    expect(
      mapAuthContextToApiDocsActor(
        requestWithAuth({ actor_type: "user", actor_id: "" })
      )
    ).toEqual({ authenticated: false })
    expect(
      mapAuthContextToApiDocsActor(
        requestWithAuth({ actor_type: "user", actor_id: "   " })
      )
    ).toEqual({ authenticated: false })
  })
})
