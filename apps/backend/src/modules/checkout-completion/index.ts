import CheckoutCompletionModuleService from "./service"
import { Module } from "@medusajs/framework/utils"

export const CHECKOUT_COMPLETION_MODULE = "checkoutCompletion"

export {
  acquireCheckoutOrderBirthAuthorityInTransaction,
  readCheckoutOrderBirthAuthorityInTransaction,
  markOrderBirthExecutionStartedInTransaction,
  bindRecoveredOrderInTransaction,
  markReconciliationRequiredInTransaction,
  markCompletedInTransaction,
  markFailedInTransaction,
  CheckoutCompletionAuthorityConflictError,
  CHECKOUT_COMPLETION_AUTHORITY_CONFLICT,
  readCheckoutCompletionLogHistory,
} from "./service"
export type {
  AcquireCheckoutOrderBirthAuthorityInput,
  AcquireCheckoutOrderBirthAuthorityResult,
  CheckoutCompletionOrderBirthAuthority,
  MarkOrderBirthExecutionStartedInput,
  MarkOrderBirthExecutionStartedResult,
  BindRecoveredOrderInput,
  MarkReconciliationRequiredInput,
  MarkCompletedInput,
  MarkFailedInput,
  ReadOrderBirthAuthorityFilters,
} from "./types"

export default Module(CHECKOUT_COMPLETION_MODULE, {
  service: CheckoutCompletionModuleService,
})
