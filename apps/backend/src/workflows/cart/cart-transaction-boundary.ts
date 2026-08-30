import { Modules } from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework/types"
import type {
  SharedTransactionContext,
  TransactionalManagerLike,
} from "../../infrastructure/store-foundation-transaction-compatibility"

export type CartTransactionSql = {
  raw(
    sql: string,
    bindings?: unknown[]
  ): Promise<{ rows?: Array<Record<string, unknown>> }>
}

type CartTransactionRepository = {
  transaction<T>(
    callback: (manager: TransactionalManagerLike) => Promise<T>
  ): Promise<T>
}

type TransactionalCartModule = {
  /**
   * Medusa exposes the transaction manager to module methods through Context,
   * but the Cart module does not expose a public transaction factory. This
   * narrow bridge is the framework transaction boundary only: no Cart data is
   * read or written through the repository here. All Cart operations continue
   * through the public Cart module API with the real manager returned below.
   */
  baseRepository_?: CartTransactionRepository
}

export async function withCartModuleTransaction<T>(
  container: MedusaContainer,
  callback: (
    transaction: CartTransactionSql,
    manager: TransactionalManagerLike,
    sharedContext: SharedTransactionContext
  ) => Promise<T>
): Promise<T> {
  const cartModule = container.resolve<TransactionalCartModule>(Modules.CART)
  const repository = cartModule.baseRepository_
  if (!repository || typeof repository.transaction !== "function") {
    throw new Error("CART_TRANSACTION_AUTHORITY_UNAVAILABLE")
  }

  return repository.transaction(async (manager) => {
    const transaction = manager.getTransactionContext?.() as
      | CartTransactionSql
      | null
      | undefined
    if (!transaction || typeof transaction.raw !== "function") {
      throw new Error("CART_TRANSACTION_CONTEXT_UNAVAILABLE")
    }

    const sharedContext: SharedTransactionContext = {
      __type: "MedusaContext",
      transactionManager: manager,
      manager,
    }
    return callback(transaction, manager, sharedContext)
  })
}
