import { Module } from "@medusajs/framework/utils"
import AdminActionLogModuleService from "./service"

export const ADMIN_ACTION_LOG_MODULE = "admin_action_log"

export { AdminActionLogModuleService }
export type {
  AdminActionFact,
  AdminActionMetadata,
  AdminActionState,
  AppendIntentInput,
  AppendOutcomeInput,
  AppendReconciliationInput,
  ListOrphanIntentsInput,
} from "./service"
export type {
  AdminAction,
  AdminActionAuditStage,
  AdminActionEntityType,
  AdminActionResult,
  AdminActionSeverity,
} from "./models/admin-action-log"
export {
  ADMIN_ACTIONS,
  ADMIN_ACTION_AUDIT_STAGES,
  ADMIN_ACTION_ENTITY_TYPES,
  ADMIN_ACTION_RESULTS,
  ADMIN_ACTION_SEVERITIES,
} from "./models/admin-action-log"

export default Module(ADMIN_ACTION_LOG_MODULE, {
  service: AdminActionLogModuleService,
})
