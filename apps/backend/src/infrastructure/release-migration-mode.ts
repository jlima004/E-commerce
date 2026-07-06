export function isReleaseMigrationMode(
  input: Record<string, string | undefined> = process.env as Record<
    string,
    string | undefined
  >
): boolean {
  return input.DTC_RELEASE_MIGRATION_MODE === "true"
}
