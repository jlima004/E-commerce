import type { LoaderOptions } from "@medusajs/framework/types"
import stripeRealInitiationLoader from "../loaders/stripe-real-initiation"

describe("stripeRealInitiationLoader", () => {
  it("nao resolve container, registra camadas nem escreve logs no filho de migration", async () => {
    const originalMode = process.env.DTC_RELEASE_MIGRATION_MODE
    const originalChild = process.env.DTC_RELEASE_MIGRATION_CHILD_PROCESS
    process.env.DTC_RELEASE_MIGRATION_MODE = "true"
    process.env.DTC_RELEASE_MIGRATION_CHILD_PROCESS = "true"
    const register = jest.fn()
    const resolve = jest.fn()
    const log = jest.spyOn(console, "log").mockImplementation(() => undefined)

    try {
      await stripeRealInitiationLoader({
        container: { register, resolve },
      } as unknown as LoaderOptions)

      expect(resolve).not.toHaveBeenCalled()
      expect(register).not.toHaveBeenCalled()
      expect(log).not.toHaveBeenCalled()
    } finally {
      log.mockRestore()
      if (originalMode === undefined) {
        delete process.env.DTC_RELEASE_MIGRATION_MODE
      } else {
        process.env.DTC_RELEASE_MIGRATION_MODE = originalMode
      }
      if (originalChild === undefined) {
        delete process.env.DTC_RELEASE_MIGRATION_CHILD_PROCESS
      } else {
        process.env.DTC_RELEASE_MIGRATION_CHILD_PROCESS = originalChild
      }
    }
  })
})
