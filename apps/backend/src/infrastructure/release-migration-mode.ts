export function isReleaseMigrationMode(
  input: Record<string, string | undefined> = process.env as Record<
    string,
    string | undefined
  >
): boolean {
  if (input.DTC_RELEASE_MIGRATION_MODE !== "true") {
    return false
  }

  if (input.WORKER_MODE === "server" || input.WORKER_MODE === "worker") {
    // Startup validation is not an HTTP boundary.
    // eslint-disable-next-line @medusajs/use-medusa-error-not-generic-error
    throw new Error(
      "Release migration mode is restricted to the migration child process"
    )
  }

  if (input.DTC_RELEASE_MIGRATION_CHILD_PROCESS !== "true") {
    // Startup validation is not an HTTP boundary.
    // eslint-disable-next-line @medusajs/use-medusa-error-not-generic-error
    throw new Error(
      "Release migration mode is restricted to the migration child process"
    )
  }

  return true
}
