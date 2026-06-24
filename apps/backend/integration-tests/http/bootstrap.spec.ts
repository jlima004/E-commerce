import fs from "fs"
import path from "path"

const backendRoot = path.resolve(__dirname, "../..")
const repoRoot = path.resolve(backendRoot, "../..")

describe("Walking Skeleton bootstrap", () => {
  it("serves Medusa Admin at /app", () => {
    const configSource = fs.readFileSync(
      path.join(backendRoot, "medusa-config.ts"),
      "utf8"
    )

    expect(configSource).toMatch(/admin:\s*{[\s\S]*path:\s*["']\/app["']/)
  })

  it("is a backend-only workspace without storefront packages", () => {
    const appsDir = path.join(repoRoot, "apps")
    const appEntries = fs
      .readdirSync(appsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)

    expect(appEntries).toEqual(["backend"])
    expect(appEntries.some((name) => /storefront/i.test(name))).toBe(false)

    const rootPkg = JSON.parse(
      fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")
    )
    const scriptNames = Object.keys(rootPkg.scripts ?? {})

    expect(scriptNames.some((name) => /storefront/i.test(name))).toBe(false)
  })
})
