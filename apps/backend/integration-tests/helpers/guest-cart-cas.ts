import type {
  StoreResourceVersionCasResult,
  StoreResourceVersionModuleService,
  StoreResourceVersionMutationContext,
} from "../../src/modules/store-resource-version/service"

export const GUEST_CART_TEST_HARNESS_FORBIDDEN =
  "GUEST_CART_TEST_HARNESS_FORBIDDEN"
export const GUEST_CART_CAS_RESOURCE_TYPE = "cart"
export const GUEST_CART_CAS_RESOURCE_TYPE_FORBIDDEN =
  "GUEST_CART_CAS_RESOURCE_TYPE_FORBIDDEN"
export const GUEST_CART_CAS_VERSION_INVALID =
  "GUEST_CART_CAS_VERSION_INVALID"
export const GUEST_CART_CAS_BIGINT_FORBIDDEN =
  "GUEST_CART_CAS_BIGINT_FORBIDDEN"

export type ExecuteGuestCartCasInput<T = void> = {
  versionService: StoreResourceVersionModuleService
  cartId: string
  expectedVersion: number
  sharedContext?: StoreResourceVersionMutationContext
  mutate: (context: StoreResourceVersionMutationContext) => Promise<T>
}

export type ExecuteGuestCartIncrementInput = {
  versionService: StoreResourceVersionModuleService
  cartId: string
  expectedVersion: number
  sharedContext?: StoreResourceVersionMutationContext
}

function assertGuestCartTestHarnessAllowed(): void {
  if (process.env.NODE_ENV !== "test") {
    const error = new Error(GUEST_CART_TEST_HARNESS_FORBIDDEN)
    ;(error as { code?: string }).code = GUEST_CART_TEST_HARNESS_FORBIDDEN
    throw error
  }
}

assertGuestCartTestHarnessAllowed()

/**
 * Validates expectedVersion ensuring it is a positive integer and rejects bigint.
 */
export function validateGuestCartExpectedVersion(version: unknown): number {
  assertGuestCartTestHarnessAllowed()

  if (typeof version === "bigint") {
    throw new Error(GUEST_CART_CAS_BIGINT_FORBIDDEN)
  }

  if (
    typeof version !== "number" ||
    !Number.isInteger(version) ||
    version <= 0
  ) {
    throw new Error(GUEST_CART_CAS_VERSION_INVALID)
  }

  return version
}

/**
 * Executes Compare-And-Swap on a cart resource using StoreResourceVersionModuleService.
 */
export async function executeGuestCartCasWithMutation<T>(
  input: ExecuteGuestCartCasInput<T>
): Promise<StoreResourceVersionCasResult<T>> {
  assertGuestCartTestHarnessAllowed()

  if (!input.cartId || typeof input.cartId !== "string") {
    throw new Error("GUEST_CART_CAS_CART_ID_REQUIRED")
  }

  const expectedVersion = validateGuestCartExpectedVersion(
    input.expectedVersion
  )

  return input.versionService.compareAndSwapWithMutation({
    resourceType: GUEST_CART_CAS_RESOURCE_TYPE,
    resourceId: input.cartId,
    expectedVersion,
    sharedContext: input.sharedContext,
    mutate: input.mutate,
  })
}

/**
 * Increments cart resource version monotonically via StoreResourceVersionModuleService.
 */
export async function executeGuestCartIncrement(
  input: ExecuteGuestCartIncrementInput
): Promise<StoreResourceVersionCasResult> {
  assertGuestCartTestHarnessAllowed()

  if (!input.cartId || typeof input.cartId !== "string") {
    throw new Error("GUEST_CART_CAS_CART_ID_REQUIRED")
  }

  const expectedVersion = validateGuestCartExpectedVersion(
    input.expectedVersion
  )

  return input.versionService.increment(
    GUEST_CART_CAS_RESOURCE_TYPE,
    input.cartId,
    expectedVersion,
    input.sharedContext
  )
}
