import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import path from "node:path"
import { readFileSync } from "node:fs"
import { describe, it } from "node:test"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, "../..")
const ecosystemPath = path.resolve(repoRoot, "ops/pm2/ecosystem.config.cjs")

const REQUIRED_APPS = ["medusa-server", "medusa-worker"]
const REQUIRED_RUNTIME_ENVS = [
  "DATABASE_URL",
  "REDIS_URL",
  "CACHE_REDIS_URL",
  "EVENTS_REDIS_URL",
  "WE_REDIS_URL",
  "APP_VERSION",
]
const FORBIDDEN_BINDS = ["0.0.0.0", "::", "*"]

function loadEcosystem() {
  const require = createRequire(import.meta.url)
  return require(ecosystemPath)
}

function getApp(apps, name) {
  const app = apps.find((entry) => entry.name === name)
  assert.ok(app, `missing PM2 app: ${name}`)
  return app
}

function commandParts(app) {
  if (Array.isArray(app.args)) {
    return [app.script, ...app.args].flat().map(String)
  }

  if (typeof app.args === "string") {
    return [app.script, ...app.args.split(/\s+/)]
  }

  return [app.script].filter(Boolean).map(String)
}

describe("PM2 ecosystem contract", () => {
  it("defines exactly medusa-server and medusa-worker", () => {
    const config = loadEcosystem()
    const names = config.apps.map((app) => app.name).sort()

    assert.deepEqual(names, [...REQUIRED_APPS].sort())
    assert.equal(config.apps.length, 2)
  })

  it("uses production build cwd under APP_ROOT for both processes", () => {
    const config = loadEcosystem()

    for (const name of REQUIRED_APPS) {
      const app = getApp(config.apps, name)
      assert.match(
        String(app.cwd),
        /\/\.medusa\/server$/,
        `${name} must run from the Medusa production build directory`
      )
      assert.match(
        String(app.cwd),
        /APP_ROOT|process\.env\.APP_ROOT|<APP_ROOT>/,
        `${name} cwd must be parameterized by APP_ROOT`
      )
    }
  })

  it("passes runtime DATABASE_URL, four Redis contracts, and APP_VERSION without literals", () => {
    const source = readFileSync(ecosystemPath, "utf8")
    const config = loadEcosystem()

    for (const name of REQUIRED_APPS) {
      const app = getApp(config.apps, name)
      const env = app.env ?? app.env_production ?? {}

      for (const key of REQUIRED_RUNTIME_ENVS) {
        assert.ok(Object.hasOwn(env, key), `${name} missing env ${key}`)
      }
    }

    assert.match(
      source,
      /APP_VERSION:\s*process\.env\.APP_VERSION/,
      "APP_VERSION must be passed from process.env.APP_VERSION only"
    )
    assert.doesNotMatch(
      source,
      /APP_VERSION:\s*["'`][^"'`]+["'`]/,
      "APP_VERSION must not use a literal fallback in the ecosystem file"
    )
    assert.doesNotMatch(
      source,
      /APP_VERSION\s*=\s*["'`]/,
      "APP_VERSION must not be assigned a literal value"
    )
  })

  it("configures server role with loopback HTTP bind and Admin enabled", () => {
    const config = loadEcosystem()
    const server = getApp(config.apps, "medusa-server")
    const parts = commandParts(server)

    assert.equal(server.env?.WORKER_MODE ?? server.env_production?.WORKER_MODE, "server")
    assert.equal(
      server.env?.ADMIN_DISABLED ?? server.env_production?.ADMIN_DISABLED,
      "false"
    )

    const hostIndex = parts.indexOf("--host")
    const portIndex = parts.indexOf("--port")

    assert.notEqual(hostIndex, -1, "medusa-server must pass --host")
    assert.notEqual(portIndex, -1, "medusa-server must pass --port")
    assert.equal(parts[hostIndex + 1], "127.0.0.1")
    assert.equal(parts[portIndex + 1], "9000")

    for (const forbidden of FORBIDDEN_BINDS) {
      assert.ok(
        !parts.includes(forbidden),
        `medusa-server must not bind to ${forbidden}`
      )
    }
  })

  it("configures worker role without Admin and without HTTP listener", () => {
    const config = loadEcosystem()
    const worker = getApp(config.apps, "medusa-worker")
    const parts = commandParts(worker)
    const serialized = JSON.stringify(worker)

    assert.equal(worker.env?.WORKER_MODE ?? worker.env_production?.WORKER_MODE, "worker")
    assert.equal(
      worker.env?.ADMIN_DISABLED ?? worker.env_production?.ADMIN_DISABLED,
      "true"
    )

    assert.equal(parts.indexOf("--host"), -1, "worker must not declare --host")
    assert.equal(parts.indexOf("--port"), -1, "worker must not declare --port")
    assert.notEqual(parts.indexOf("start"), -1, "worker must run medusa start without HTTP bind")

    for (const forbidden of FORBIDDEN_BINDS) {
      assert.ok(
        !serialized.includes(forbidden),
        `worker must not reference HTTP bind ${forbidden}`
      )
    }
  })

  it("declares conservative restart and shutdown timeouts", () => {
    const config = loadEcosystem()

    for (const name of REQUIRED_APPS) {
      const app = getApp(config.apps, name)

      assert.ok(
        typeof app.listen_timeout === "number" && app.listen_timeout > 0,
        `${name} must define listen_timeout`
      )
      assert.ok(
        typeof app.kill_timeout === "number" && app.kill_timeout > 0,
        `${name} must define kill_timeout`
      )
      assert.ok(app.autorestart !== false, `${name} must autorestart`)
    }
  })
})
