import { randomBytes } from "node:crypto"
import { spawn } from "node:child_process"
import { createConnection, type Socket } from "node:net"
import { AUTH_TEST_HARNESS_FORBIDDEN, AuthTestHarnessError } from "./auth-postgres"
import { normalizeLoopbackHostname } from "../postgres/disposable-postgres-harness"

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"])
const CONTAINER_PATTERN = /^p14-auth-redis-[a-f0-9]+$/
const NAMESPACE_PATTERN = /^p14-auth:[a-f0-9]+:$/
const READINESS_ATTEMPTS = 60
const READINESS_DELAY_MS = 250

export type AuthRedisCleanupResult = {
  namespaceKeysDeleted: number
  outsideKeysDeleted: number
  containerName: string
  containerRemoved: boolean
}

export type AuthRedisHarness = {
  readonly namespace: string
  readonly hostname: string
  readonly port: string
  readonly containerName: string
  setKey(suffix: string, value: string): Promise<void>
  getKey(suffix: string): Promise<string | null>
  plantOutsideKey(suffix: string, value: string): Promise<string>
  readExactKey(key: string): Promise<string | null>
  deleteExactKey(key: string): Promise<void>
  flushNamespace(): Promise<{ deleted: number }>
  inspectNamespaceKeys(): Promise<string[]>
  enableOutage(): void
  disableOutage(): void
  cleanup(): Promise<AuthRedisCleanupResult>
}

export type AuthRedisBinding = {
  host: string
  port: number
  namespace: string
}

const redisBindings = new WeakMap<AuthRedisHarness, AuthRedisBinding>()
const liveContainers = new Set<string>()
let processGuardsInstalled = false

type RespValue = string | number | null | RespValue[]

function assertAuthTestHarness(): void {
  if (process.env.NODE_ENV !== "test") {
    throw new AuthTestHarnessError(AUTH_TEST_HARNESS_FORBIDDEN)
  }
}

assertAuthTestHarness()

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function runCommand(
  command: string,
  args: string[]
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString()
    })
    child.once("error", (error) => {
      const code =
        error && typeof error === "object" && "code" in error
          ? String((error as { code?: unknown }).code)
          : ""
      resolve({
        code: code === "ENOENT" ? 127 : 1,
        stdout: "",
        stderr: "",
      })
    })
    child.once("exit", (code) => {
      resolve({ code: code ?? 1, stdout, stderr })
    })
  })
}

export function validateAuthRedisUrl(rawUrl: unknown): URL {
  assertAuthTestHarness()

  if (typeof rawUrl !== "string" || rawUrl.trim() === "") {
    throw new AuthTestHarnessError("AUTH_TEST_REDIS_URL_REQUIRED")
  }

  let url: URL

  try {
    url = new URL(rawUrl)
  } catch {
    throw new AuthTestHarnessError("AUTH_TEST_REDIS_URL_INVALID")
  }

  if (url.protocol !== "redis:") {
    throw new AuthTestHarnessError("AUTH_TEST_REDIS_PROTOCOL_FORBIDDEN")
  }

  const hostname = normalizeLoopbackHostname(url.hostname)

  if (!LOOPBACK_HOSTS.has(hostname)) {
    throw new AuthTestHarnessError("AUTH_TEST_REDIS_HOST_FORBIDDEN")
  }

  return url
}

function requireContainerName(value: string): string {
  if (!CONTAINER_PATTERN.test(value)) {
    throw new AuthTestHarnessError("AUTH_TEST_REDIS_CONTAINER_FORBIDDEN")
  }
  return value
}

function encodeResp(args: string[]): Buffer {
  const parts = [Buffer.from(`*${args.length}\r\n`)]
  for (const arg of args) {
    const payload = Buffer.from(arg, "utf8")
    parts.push(
      Buffer.from(`$${payload.length}\r\n`),
      payload,
      Buffer.from("\r\n")
    )
  }
  return Buffer.concat(parts)
}

function parseResp(
  buffer: Buffer,
  offset: number
): { value: RespValue; next: number } | null {
  if (offset >= buffer.length) {
    return null
  }

  const type = String.fromCharCode(buffer[offset]!)
  const headerEnd = buffer.indexOf("\r\n", offset)
  if (headerEnd < 0) {
    return null
  }

  const header = buffer.slice(offset + 1, headerEnd).toString("utf8")

  if (type === "+" || type === ":") {
    return {
      value: type === ":" ? Number(header) : header,
      next: headerEnd + 2,
    }
  }

  if (type === "-") {
    throw new AuthTestHarnessError("AUTH_TEST_REDIS_FAILED")
  }

  if (type === "$") {
    const size = Number(header)
    if (size === -1) {
      return { value: null, next: headerEnd + 2 }
    }
    const start = headerEnd + 2
    const end = start + size
    if (buffer.length < end + 2) {
      return null
    }
    return {
      value: buffer.slice(start, end).toString("utf8"),
      next: end + 2,
    }
  }

  if (type === "*") {
    const count = Number(header)
    if (count === -1) {
      return { value: null, next: headerEnd + 2 }
    }
    let cursor = headerEnd + 2
    const items: RespValue[] = []
    for (let index = 0; index < count; index += 1) {
      const parsed = parseResp(buffer, cursor)
      if (!parsed) {
        return null
      }
      items.push(parsed.value)
      cursor = parsed.next
    }
    return { value: items, next: cursor }
  }

  throw new AuthTestHarnessError("AUTH_TEST_REDIS_FAILED")
}

class QuietCacheClient {
  private socket: Socket | null = null
  private buffer = Buffer.alloc(0)
  private pending: Array<{
    resolve: (value: RespValue) => void
    reject: (error: Error) => void
  }> = []
  private outage = false

  enableOutage(): void {
    this.outage = true
  }

  disableOutage(): void {
    this.outage = false
  }

  async connect(host: string, port: number): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const socket = createConnection({ host, port })
      socket.setNoDelay(true)
      socket.once("connect", () => {
        this.socket = socket
        socket.on("data", (chunk) => this.onData(chunk))
        socket.on("error", () => this.failPending())
        socket.on("close", () => this.failPending())
        resolve()
      })
      socket.once("error", () => {
        reject(new AuthTestHarnessError("AUTH_TEST_REDIS_FAILED"))
      })
    })
  }

  async command(...args: string[]): Promise<RespValue> {
    if (this.outage) {
      throw new AuthTestHarnessError("AUTH_TEST_REDIS_OUTAGE")
    }
    if (!this.socket) {
      throw new AuthTestHarnessError("AUTH_TEST_REDIS_FAILED")
    }

    return new Promise<RespValue>((resolve, reject) => {
      this.pending.push({ resolve, reject })
      this.socket!.write(encodeResp(args))
    })
  }

  async close(): Promise<void> {
    const socket = this.socket
    this.socket = null
    this.failPending()
    if (!socket) {
      return
    }
    await new Promise<void>((resolve) => {
      socket.once("close", () => resolve())
      socket.end()
      setTimeout(() => {
        socket.destroy()
        resolve()
      }, 500)
    })
  }

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk])
    while (this.pending.length > 0) {
      let parsed: { value: RespValue; next: number } | null
      try {
        parsed = parseResp(this.buffer, 0)
      } catch (error) {
        this.buffer = Buffer.alloc(0)
        const waiter = this.pending.shift()
        waiter?.reject(
          error instanceof AuthTestHarnessError
            ? error
            : new AuthTestHarnessError("AUTH_TEST_REDIS_FAILED")
        )
        return
      }
      if (!parsed) {
        return
      }
      this.buffer = this.buffer.slice(parsed.next)
      const waiter = this.pending.shift()
      waiter?.resolve(parsed.value)
    }
  }

  private failPending(): void {
    const waiters = this.pending.splice(0)
    for (const waiter of waiters) {
      waiter.reject(new AuthTestHarnessError("AUTH_TEST_REDIS_FAILED"))
    }
  }
}

async function removeExactContainer(containerName: string): Promise<boolean> {
  requireContainerName(containerName)
  await runCommand("docker", ["rm", "--force", containerName])
  const inspect = await runCommand("docker", ["inspect", containerName])
  if (inspect.code === 0) {
    throw new AuthTestHarnessError("AUTH_TEST_REDIS_CONTAINER_RESIDUE")
  }
  liveContainers.delete(containerName)
  return true
}

function installProcessGuards(): void {
  if (processGuardsInstalled) {
    return
  }
  processGuardsInstalled = true
  const emergency = () => {
    for (const containerName of [...liveContainers]) {
      void removeExactContainer(containerName).catch(() => undefined)
    }
  }
  process.once("SIGINT", emergency)
  process.once("SIGTERM", emergency)
  process.once("beforeExit", emergency)
}

async function waitForCacheReady(containerName: string): Promise<void> {
  for (let attempt = 1; attempt <= READINESS_ATTEMPTS; attempt += 1) {
    const result = await runCommand("docker", [
      "exec",
      containerName,
      "redis-cli",
      "ping",
    ])
    if (result.code === 0 && result.stdout.trim() === "PONG") {
      return
    }
    await delay(READINESS_DELAY_MS)
  }
  throw new AuthTestHarnessError("AUTH_TEST_REDIS_UNAVAILABLE")
}

function namespacedKey(namespace: string, suffix: string): string {
  if (!NAMESPACE_PATTERN.test(namespace)) {
    throw new AuthTestHarnessError("AUTH_TEST_REDIS_NAMESPACE_FORBIDDEN")
  }
  if (!/^[a-zA-Z0-9:_-]+$/.test(suffix)) {
    throw new AuthTestHarnessError("AUTH_TEST_REDIS_KEY_FORBIDDEN")
  }
  return `${namespace}${suffix}`
}

export function getAuthRedisTestBinding(
  harness: AuthRedisHarness
): AuthRedisBinding {
  assertAuthTestHarness()
  const binding = redisBindings.get(harness)
  if (!binding) {
    throw new AuthTestHarnessError(AUTH_TEST_HARNESS_FORBIDDEN)
  }
  return binding
}

export async function createAuthRedisHarness(): Promise<AuthRedisHarness> {
  assertAuthTestHarness()
  installProcessGuards()

  const dockerInfo = await runCommand("docker", ["info"])
  if (dockerInfo.code !== 0) {
    throw new AuthTestHarnessError("AUTH_TEST_REDIS_UNAVAILABLE")
  }

  const runId = randomBytes(8).toString("hex")
  const containerName = requireContainerName(`p14-auth-redis-${runId}`)
  const namespace = `p14-auth:${runId}:`
  const plantedOutside = new Set<string>()
  const client = new QuietCacheClient()
  let cleaned = false
  let hostname = "127.0.0.1"
  let port = ""

  liveContainers.add(containerName)

  try {
    const started = await runCommand("docker", [
      "run",
      "--detach",
      "--name",
      containerName,
      "--publish",
      "127.0.0.1::6379",
      "redis:7-alpine",
    ])

    if (started.code !== 0) {
      throw new AuthTestHarnessError("AUTH_TEST_REDIS_UNAVAILABLE")
    }

    const portResult = await runCommand("docker", [
      "port",
      containerName,
      "6379/tcp",
    ])
    const publishedPort = portResult.stdout.trim().match(/:(\d+)$/)?.[1]

    if (portResult.code !== 0 || !publishedPort || publishedPort === "6379") {
      throw new AuthTestHarnessError("AUTH_TEST_REDIS_UNAVAILABLE")
    }

    hostname = "127.0.0.1"
    port = publishedPort

    validateAuthRedisUrl(`redis://${hostname}:${port}`)
    await waitForCacheReady(containerName)
    await client.connect(hostname, Number(port))
  } catch (error) {
    await client.close().catch(() => undefined)
    await removeExactContainer(containerName).catch(() => undefined)
    if (error instanceof AuthTestHarnessError) {
      throw error
    }
    throw new AuthTestHarnessError("AUTH_TEST_REDIS_UNAVAILABLE")
  }

  async function scanNamespaceKeys(): Promise<string[]> {
    const found: string[] = []
    let cursor = "0"
    do {
      const reply = await client.command(
        "SCAN",
        cursor,
        "MATCH",
        `${namespace}*`,
        "COUNT",
        "32"
      )
      if (!Array.isArray(reply) || reply.length < 2) {
        throw new AuthTestHarnessError("AUTH_TEST_REDIS_FAILED")
      }
      cursor = String(reply[0])
      const batch = Array.isArray(reply[1]) ? reply[1] : []
      for (const key of batch) {
        const name = String(key)
        if (name.startsWith(namespace)) {
          found.push(name)
        }
      }
    } while (cursor !== "0")
    return found
  }

  async function deleteExactKeys(keys: string[]): Promise<number> {
    let deleted = 0
    for (const key of keys) {
      const result = await client.command("DEL", key)
      deleted += typeof result === "number" ? result : 0
    }
    return deleted
  }

  const harness: AuthRedisHarness = {
    namespace,
    hostname,
    port,
    containerName,
    async setKey(suffix, value) {
      assertAuthTestHarness()
      await client.command("SET", namespacedKey(namespace, suffix), value)
    },
    async getKey(suffix) {
      assertAuthTestHarness()
      const result = await client.command("GET", namespacedKey(namespace, suffix))
      return result === null ? null : String(result)
    },
    async plantOutsideKey(suffix, value) {
      assertAuthTestHarness()
      if (!/^[a-zA-Z0-9:_-]+$/.test(suffix)) {
        throw new AuthTestHarnessError("AUTH_TEST_REDIS_KEY_FORBIDDEN")
      }
      const key = `p14-auth-outside:${runId}:${suffix}`
      await client.command("SET", key, value)
      plantedOutside.add(key)
      return key
    },
    async readExactKey(key) {
      assertAuthTestHarness()
      const ownedOutsidePrefix = `p14-auth-outside:${runId}:`
      if (
        !plantedOutside.has(key) &&
        !key.startsWith(namespace) &&
        !key.startsWith(ownedOutsidePrefix)
      ) {
        throw new AuthTestHarnessError("AUTH_TEST_REDIS_KEY_FORBIDDEN")
      }
      const result = await client.command("GET", key)
      return result === null ? null : String(result)
    },
    async deleteExactKey(key) {
      assertAuthTestHarness()
      const ownedOutsidePrefix = `p14-auth-outside:${runId}:`
      if (
        !plantedOutside.has(key) &&
        !key.startsWith(namespace) &&
        !key.startsWith(ownedOutsidePrefix)
      ) {
        throw new AuthTestHarnessError("AUTH_TEST_REDIS_KEY_FORBIDDEN")
      }
      await client.command("DEL", key)
      plantedOutside.delete(key)
    },
    async flushNamespace() {
      assertAuthTestHarness()
      const keys = await scanNamespaceKeys()
      const deleted = await deleteExactKeys(keys)
      return { deleted }
    },
    async inspectNamespaceKeys() {
      assertAuthTestHarness()
      return scanNamespaceKeys()
    },
    enableOutage() {
      assertAuthTestHarness()
      client.enableOutage()
    },
    disableOutage() {
      assertAuthTestHarness()
      client.disableOutage()
    },
    async cleanup() {
      assertAuthTestHarness()
      if (cleaned) {
        return {
          namespaceKeysDeleted: 0,
          outsideKeysDeleted: 0,
          containerName,
          containerRemoved: true,
        }
      }

      let namespaceKeysDeleted = 0
      let outsideKeysDeleted = 0

      try {
        client.disableOutage()
        const namespaceKeys = await scanNamespaceKeys().catch(() => [])
        namespaceKeysDeleted = await deleteExactKeys(namespaceKeys).catch(
          () => 0
        )
        const outsideKeys = [...plantedOutside]
        outsideKeysDeleted = await deleteExactKeys(outsideKeys).catch(() => 0)
        plantedOutside.clear()
      } finally {
        await client.close().catch(() => undefined)
        const containerRemoved = await removeExactContainer(containerName)
        cleaned = true
        return {
          namespaceKeysDeleted,
          outsideKeysDeleted,
          containerName,
          containerRemoved,
        }
      }
    },
  }

  redisBindings.set(harness, {
    host: hostname,
    port: Number(port),
    namespace,
  })

  return harness
}
