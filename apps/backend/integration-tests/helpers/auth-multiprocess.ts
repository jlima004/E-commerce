import { spawn, type ChildProcess } from "node:child_process"
import { randomBytes } from "node:crypto"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import http from "node:http"
import { createRequire } from "node:module"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { isAbsolute, join, resolve, sep } from "node:path"
import {
  AUTH_TEST_HARNESS_FORBIDDEN,
  AuthTestHarnessError,
  getAuthPostgresTestBinding,
  type AuthPostgresHarness,
} from "./auth-postgres"
import {
  getAuthRedisTestBinding,
  type AuthRedisHarness,
} from "./auth-redis"

export type TwoProcessListener = {
  host: string
  port: number
}

export type TwoProcessReadyChecks = {
  postgres: "up" | "down"
  redis: "up" | "down"
}

export type MedusaProcessObservation = {
  pid: number
  postgres: number
  redis: string
  origin: "medusa-process"
}

export type TwoProcessProofResult = {
  processType: "MEDUSA"
  pids: [number, number]
  listeners: [TwoProcessListener, TwoProcessListener]
  redisNamespace: string
  databaseName: string
  postgresObserved: [number, number]
  cacheObserved: [string, string]
  observations: [MedusaProcessObservation, MedusaProcessObservation]
  observationOrigin: ["medusa-process", "medusa-process"]
  liveService: "medusa-backend"
  readyChecks: [TwoProcessReadyChecks, TwoProcessReadyChecks]
}

const BACKEND_ROOT = resolve(__dirname, "../..")
const LOOPBACK_HOST = "127.0.0.1"
const MEDUSA_PROCESS_TYPE = "MEDUSA" as const
const MEDUSA_LIVE_SERVICE = "medusa-backend" as const
const MEDUSA_BOOT_TIMEOUT_MS = 90_000
const HTTP_PROBE_TIMEOUT_MS = 2_000
const SIGTERM_WAIT_MS = 10_000
const SIGKILL_WAIT_MS = 2_000
const OBSERVER_READY_TIMEOUT_MS = 15_000
const OBSERVER_QUERY_TIMEOUT_MS = 15_000
const SYSTEM_DATABASES = new Set(["postgres", "template0", "template1"])
const COUNTER_TABLE_PATTERN = /^p14_auth_counter_[a-f0-9]+$/
const REDIS_NAMESPACE_PATTERN = /^p14-auth:[a-f0-9]+:$/
const PARENT_REDIS_KEYS = [
  "REDIS_URL",
  "CACHE_REDIS_URL",
  "EVENTS_REDIS_URL",
  "WE_REDIS_URL",
] as const
const OBSERVER_ORIGIN = "medusa-process" as const
const OBSERVER_PRELOAD_SOURCE = `"use strict";
const net = require("node:net");

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1"]);
const SYSTEM_DATABASES = new Set(["postgres", "template0", "template1"]);
const COUNTER_TABLE_PATTERN = /^p14_auth_counter_[a-f0-9]+$/;
const REDIS_NAMESPACE_PATTERN = /^p14-auth:[a-f0-9]+:$/;

function fail(code) {
  process.stderr.write("[P14_AUTH_OBSERVER] " + code + "\\n");
  process.exit(1);
}

function env(name) {
  const value = process.env[name];
  return typeof value === "string" ? value : "";
}

function requireLoopbackUrl(raw, kind) {
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    fail("AUTH_TEST_OBSERVER_" + kind + "_URL");
  }
  const host = parsed.hostname.replace(/^\\[|\\]$/g, "").toLowerCase();
  if (!LOOPBACK.has(host)) {
    fail("AUTH_TEST_OBSERVER_" + kind + "_HOST");
  }
  return parsed;
}

(function boot() {
  if (env("P14_AUTH_OBSERVER_ENABLED") !== "1") {
    return;
  }
  if (env("NODE_ENV") !== "test") {
    fail("AUTH_TEST_OBSERVER_NODE_ENV");
  }
  if (env("P14_AUTH_OBSERVER_PROTOCOL") !== "1") {
    fail("AUTH_TEST_OBSERVER_PROTOCOL");
  }
  const role = env("P14_AUTH_OBSERVER_ROLE");
  if (role !== "A" && role !== "B") {
    fail("AUTH_TEST_OBSERVER_ROLE");
  }
  const runId = env("P14_AUTH_OBSERVER_RUN_ID");
  if (!/^[a-f0-9]{16}$/.test(runId)) {
    fail("AUTH_TEST_OBSERVER_RUN_ID");
  }
  const token = env("P14_AUTH_OBSERVER_TOKEN");
  if (!/^[a-f0-9]{64}$/.test(token)) {
    fail("AUTH_TEST_OBSERVER_TOKEN");
  }
  const parentPid = Number(env("P14_AUTH_OBSERVER_PARENT_PID"));
  if (!Number.isInteger(parentPid) || parentPid <= 0 || parentPid === process.pid) {
    fail("AUTH_TEST_OBSERVER_PARENT_PID");
  }
  if (process.ppid !== parentPid) {
    fail("AUTH_TEST_OBSERVER_PPID");
  }
  const cliPath = env("P14_AUTH_OBSERVER_CLI_PATH");
  if (!cliPath || process.argv[1] !== cliPath) {
    fail("AUTH_TEST_OBSERVER_CLI_PATH");
  }
  const counterTable = env("P14_AUTH_OBSERVER_COUNTER_TABLE");
  if (!COUNTER_TABLE_PATTERN.test(counterTable)) {
    fail("AUTH_TEST_OBSERVER_COUNTER_TABLE");
  }
  const redisNamespace = env("P14_AUTH_OBSERVER_REDIS_NAMESPACE");
  if (!REDIS_NAMESPACE_PATTERN.test(redisNamespace)) {
    fail("AUTH_TEST_OBSERVER_REDIS_NAMESPACE");
  }
  const pgEntry = env("P14_AUTH_OBSERVER_PG_ENTRY");
  if (!pgEntry.endsWith("node_modules/pg/lib/index.js") && !pgEntry.endsWith("node_modules\\\\pg\\\\lib\\\\index.js")) {
    fail("AUTH_TEST_OBSERVER_PG_ENTRY");
  }
  if (typeof process.send !== "function") {
    fail("AUTH_TEST_OBSERVER_IPC");
  }

  let observing = false;

  async function readPostgres() {
    const databaseUrl = env("DATABASE_URL");
    const expectedDb = env("DB_TEMP_NAME");
    requireLoopbackUrl(databaseUrl, "PG");
    if (!expectedDb || SYSTEM_DATABASES.has(expectedDb)) {
      throw new Error("AUTH_TEST_OBSERVER_DATABASE");
    }
    const { Client } = require(pgEntry);
    const client = new Client({ connectionString: databaseUrl });
    try {
      await client.connect();
      const db = await client.query("select current_database() as name");
      if (!db.rows[0] || db.rows[0].name !== expectedDb) {
        throw new Error("AUTH_TEST_OBSERVER_DATABASE");
      }
      const result = await client.query(
        'select value::text as value from "' + counterTable + '" where id = $1',
        ["shared"]
      );
      if (result.rowCount !== 1 || !result.rows[0]) {
        throw new Error("AUTH_TEST_OBSERVER_PG_ROWS");
      }
      const value = Number(result.rows[0].value);
      if (!Number.isInteger(value)) {
        throw new Error("AUTH_TEST_OBSERVER_PG_VALUE");
      }
      return value;
    } finally {
      await client.end().catch(function () {});
    }
  }

  function readRedis() {
    const parsed = requireLoopbackUrl(env("REDIS_URL"), "REDIS");
    const port = Number(parsed.port);
    if (!Number.isInteger(port) || port <= 0 || port === 6379) {
      throw new Error("AUTH_TEST_OBSERVER_REDIS_PORT");
    }
    const key = redisNamespace + "shared";
    const host = parsed.hostname.replace(/^\\[|\\]$/g, "");
    const connectHost = host === "localhost" || host === "::1" ? "127.0.0.1" : host;
    const payload = Buffer.concat([
      Buffer.from("*2\\r\\n$3\\r\\nGET\\r\\n$" + Buffer.byteLength(key) + "\\r\\n"),
      Buffer.from(key),
      Buffer.from("\\r\\n"),
    ]);
    return new Promise(function (resolve, reject) {
      const socket = net.connect({ host: connectHost, port: port, family: 4 });
      let buf = Buffer.alloc(0);
      const timer = setTimeout(function () {
        socket.destroy();
        reject(new Error("AUTH_TEST_OBSERVER_REDIS_TIMEOUT"));
      }, 5000);
      socket.on("connect", function () {
        socket.write(payload);
      });
      socket.on("data", function (chunk) {
        buf = Buffer.concat([buf, chunk]);
        if (!buf.length) {
          return;
        }
        if (buf[0] === 45) {
          clearTimeout(timer);
          socket.destroy();
          reject(new Error("AUTH_TEST_OBSERVER_REDIS_ERR"));
          return;
        }
        if (buf[0] !== 36) {
          return;
        }
        const headerEnd = buf.indexOf("\\r\\n");
        if (headerEnd < 0) {
          return;
        }
        const len = Number(buf.slice(1, headerEnd).toString("utf8"));
        if (len < 0) {
          clearTimeout(timer);
          socket.end();
          resolve(null);
          return;
        }
        const start = headerEnd + 2;
        if (buf.length < start + len + 2) {
          return;
        }
        const value = buf.slice(start, start + len).toString("utf8");
        clearTimeout(timer);
        socket.end();
        resolve(value);
      });
      socket.on("error", function () {
        clearTimeout(timer);
        reject(new Error("AUTH_TEST_OBSERVER_REDIS_CONN"));
      });
    });
  }

  process.on("message", function (message) {
    if (!message || typeof message !== "object") {
      return;
    }
    if (message.v !== 1 || message.type !== "observe") {
      return;
    }
    if (observing) {
      return;
    }
    if (message.role !== role || message.runId !== runId || message.token !== token) {
      return;
    }
    if (typeof message.challenge !== "string" || !/^[a-f0-9]{64}$/.test(message.challenge)) {
      return;
    }
    observing = true;
    Promise.all([readPostgres(), readRedis()])
      .then(function (values) {
        if (typeof process.send !== "function") {
          fail("AUTH_TEST_OBSERVER_IPC");
        }
        process.send({
          v: 1,
          type: "observation",
          role: role,
          runId: runId,
          challenge: message.challenge,
          pid: process.pid,
          ppid: process.ppid,
          postgres: values[0],
          redis: values[1],
          origin: "medusa-process",
        });
      })
      .catch(function () {
        fail("AUTH_TEST_OBSERVER_QUERY");
      });
  });

  process.send({
    v: 1,
    type: "observer-ready",
    role: role,
    runId: runId,
    pid: process.pid,
    ppid: process.ppid,
    origin: "medusa-process",
  });
})();
`

function assertAuthTestHarness(): void {
  if (process.env.NODE_ENV !== "test") {
    throw new AuthTestHarnessError(AUTH_TEST_HARNESS_FORBIDDEN)
  }
}

assertAuthTestHarness()

type ObserverRole = "A" | "B"

type ObserverPreload = {
  dir: string
  file: string
  runId: string
  pgEntry: string
  parentPid: number
  counterTable: string
  redisNamespace: string
  cliPath: string
}

type IpcMailbox = {
  waitFor(
    predicate: (message: Record<string, unknown>) => boolean,
    timeoutMs: number,
    code: string
  ): Promise<Record<string, unknown>>
}

type MedusaHandle = {
  child: ChildProcess
  pid: number
  port: number
  role: ObserverRole
  token: string
  mailbox: IpcMailbox
  logs: () => string
}

type LivePayload = {
  service?: unknown
  status?: unknown
}

type ReadyPayload = {
  service?: unknown
  status?: unknown
  checks?: {
    postgres?: unknown
    redis?: unknown
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds))
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  code: string
): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(blocked(code)), timeoutMs)
      }),
    ])
  } finally {
    if (timer) {
      clearTimeout(timer)
    }
  }
}

function blocked(code: string): AuthTestHarnessError {
  return new AuthTestHarnessError(`BLOCKED: ${code}`)
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null
  }
  return value as Record<string, unknown>
}

function attachMailbox(child: ChildProcess): IpcMailbox {
  const buffered: Record<string, unknown>[] = []
  const waiters: Array<{
    predicate: (message: Record<string, unknown>) => boolean
    resolve: (message: Record<string, unknown>) => void
  }> = []

  child.on("message", (raw) => {
    const message = asRecord(raw)
    if (!message) {
      return
    }
    const index = waiters.findIndex((waiter) => waiter.predicate(message))
    if (index >= 0) {
      const waiter = waiters.splice(index, 1)[0]
      waiter?.resolve(message)
      return
    }
    buffered.push(message)
  })

  return {
    waitFor(predicate, timeoutMs, code) {
      const existing = buffered.findIndex((message) => predicate(message))
      if (existing >= 0) {
        const [message] = buffered.splice(existing, 1)
        return Promise.resolve(message!)
      }

      let timer: NodeJS.Timeout | undefined
      let waiter: (typeof waiters)[number] | undefined

      const timeoutPromise = new Promise<Record<string, unknown>>((_, reject) => {
        timer = setTimeout(() => {
          if (waiter) {
            const waiterIndex = waiters.indexOf(waiter)
            if (waiterIndex >= 0) {
              waiters.splice(waiterIndex, 1)
            }
          }
          reject(blocked(code))
        }, timeoutMs)
      })

      const messagePromise = new Promise<Record<string, unknown>>((resolve) => {
        waiter = { predicate, resolve }
        waiters.push(waiter)
      })

      return Promise.race([messagePromise, timeoutPromise]).finally(() => {
        if (timer) {
          clearTimeout(timer)
        }
      })
    },
  }
}

function resolvePgEntry(): string {
  const requireFromBackend = createRequire(join(BACKEND_ROOT, "package.json"))
  const resolved = requireFromBackend.resolve("pg")
  const marker = `${sep}node_modules${sep}pg${sep}`
  if (!isAbsolute(resolved) || !resolved.includes(marker)) {
    throw blocked("AUTH_TEST_OBSERVER_PG_ENTRY")
  }
  return resolved
}

async function createObserverPreload(input: {
  cliPath: string
  counterTable: string
  redisNamespace: string
}): Promise<ObserverPreload> {
  if (!COUNTER_TABLE_PATTERN.test(input.counterTable)) {
    throw blocked("AUTH_TEST_OBSERVER_COUNTER_TABLE")
  }
  if (!REDIS_NAMESPACE_PATTERN.test(input.redisNamespace)) {
    throw blocked("AUTH_TEST_OBSERVER_REDIS_NAMESPACE")
  }

  const dir = await mkdtemp(join(tmpdir(), "p14-auth-medusa-observer-"))
  const file = join(dir, "observer.cjs")
  try {
    await writeFile(file, OBSERVER_PRELOAD_SOURCE, { mode: 0o600, flag: "wx" })
    return {
      dir,
      file,
      runId: randomBytes(8).toString("hex"),
      pgEntry: resolvePgEntry(),
      parentPid: process.pid,
      counterTable: input.counterTable,
      redisNamespace: input.redisNamespace,
      cliPath: input.cliPath,
    }
  } catch (error) {
    await rm(dir, { recursive: true, force: true })
    if (error instanceof AuthTestHarnessError) {
      throw error
    }
    throw blocked("AUTH_TEST_OBSERVER_PRELOAD")
  }
}

async function removeObserverPreload(preload: ObserverPreload | undefined): Promise<void> {
  if (!preload) {
    return
  }
  await rm(preload.dir, { recursive: true, force: true })
}

function requirePositivePid(pid: number | undefined): number {
  if (!pid || pid <= 0) {
    throw blocked("AUTH_TEST_MEDUSA_SPAWN_FAILED")
  }
  return pid
}

function parseObservation(
  message: Record<string, unknown>,
  expected: {
    role: ObserverRole
    runId: string
    challenge: string
    pid: number
    parentPid: number
  }
): MedusaProcessObservation {
  if (
    message.v !== 1 ||
    message.type !== "observation" ||
    message.role !== expected.role ||
    message.runId !== expected.runId ||
    message.challenge !== expected.challenge ||
    message.origin !== OBSERVER_ORIGIN
  ) {
    throw blocked("AUTH_TEST_OBSERVER_RESPONSE")
  }

  const pid = message.pid
  const ppid = message.ppid
  const postgres = message.postgres
  const redis = message.redis

  if (
    typeof pid !== "number" ||
    !Number.isInteger(pid) ||
    pid !== expected.pid ||
    pid === expected.parentPid ||
    pid === process.pid
  ) {
    throw blocked("AUTH_TEST_OBSERVER_PID")
  }
  if (ppid !== expected.parentPid) {
    throw blocked("AUTH_TEST_OBSERVER_PPID")
  }
  if (typeof postgres !== "number" || !Number.isInteger(postgres)) {
    throw blocked("AUTH_TEST_OBSERVER_PG_VALUE")
  }
  if (typeof redis !== "string" || redis.length === 0) {
    throw blocked("AUTH_TEST_OBSERVER_REDIS_VALUE")
  }

  return {
    pid,
    postgres,
    redis,
    origin: OBSERVER_ORIGIN,
  }
}

async function observeFromMedusa(
  handle: MedusaHandle,
  preload: ObserverPreload
): Promise<MedusaProcessObservation> {
  const challenge = randomBytes(32).toString("hex")
  if (typeof handle.child.send !== "function") {
    throw blocked("AUTH_TEST_OBSERVER_IPC")
  }
  if (handle.child.pid !== handle.pid) {
    throw blocked("AUTH_TEST_OBSERVER_PID")
  }

  const sent = handle.child.send({
    v: 1,
    type: "observe",
    role: handle.role,
    runId: preload.runId,
    token: handle.token,
    challenge,
  })
  if (sent === false) {
    throw blocked("AUTH_TEST_OBSERVER_IPC")
  }

  const message = await handle.mailbox.waitFor(
    (incoming) =>
      incoming.type === "observation" &&
      incoming.role === handle.role &&
      incoming.challenge === challenge,
    OBSERVER_QUERY_TIMEOUT_MS,
    "AUTH_TEST_OBSERVER_TIMEOUT"
  )

  return parseObservation(message, {
    role: handle.role,
    runId: preload.runId,
    challenge,
    pid: handle.pid,
    parentPid: preload.parentPid,
  })
}

function resolveMedusaCli(): string {
  const requireFromBackend = createRequire(join(BACKEND_ROOT, "package.json"))
  return requireFromBackend.resolve("@medusajs/cli/cli.js")
}

function requireLoopbackRedis(host: string, port: number): string {
  const normalized = host.trim().toLowerCase()
  if (
    normalized !== "127.0.0.1" &&
    normalized !== "localhost" &&
    normalized !== "::1"
  ) {
    throw new AuthTestHarnessError("AUTH_TEST_REDIS_HOST_FORBIDDEN")
  }
  if (!Number.isInteger(port) || port <= 0 || port === 6379) {
    throw new AuthTestHarnessError("AUTH_TEST_REDIS_UNAVAILABLE")
  }
  return `redis://${LOOPBACK_HOST}:${port}`
}

function toMedusaDatabaseUrl(raw: string): string {
  return raw
    .replace("@127.0.0.1:", "@localhost:")
    .replace("@[::1]:", "@localhost:")
}

function requireDisposableDatabaseName(databaseName: string): string {
  if (SYSTEM_DATABASES.has(databaseName)) {
    throw new AuthTestHarnessError("AUTH_TEST_POSTGRES_DATABASE_FORBIDDEN")
  }
  return databaseName
}

function buildMedusaChildEnv(input: {
  port: number
  databaseUrl: string
  databaseName: string
  redisUrl: string
  role: ObserverRole
  token: string
  preload: ObserverPreload
}): NodeJS.ProcessEnv {
  const databaseUrl = toMedusaDatabaseUrl(input.databaseUrl)
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: "test",
    HOST: LOOPBACK_HOST,
    PORT: String(input.port),
    DATABASE_URL: databaseUrl,
    DATABASE_MIGRATION_URL: databaseUrl,
    DB_TEMP_NAME: input.databaseName,
    REDIS_URL: input.redisUrl,
    CACHE_REDIS_URL: input.redisUrl,
    EVENTS_REDIS_URL: input.redisUrl,
    WE_REDIS_URL: input.redisUrl,
    WORKER_MODE: "server",
    MEDUSA_DISABLE_TELEMETRY: "true",
    ADMIN_DISABLED: "true",
    STRIPE_REAL_INITIATION_ENABLED: "false",
    STRIPE_WEBHOOK_INGESTION_ENABLED: "false",
    STRIPE_SECRET_KEY: "",
    STRIPE_WEBHOOK_SECRET: "",
    RESEND_ORDER_CONFIRMATION_ENABLED: "false",
    RESEND_API_KEY: "",
    RESEND_FROM_EMAIL: "",
    GELATO_DISPATCH_ENABLED: "false",
    GELATO_API_KEY: "",
    GELATO_WEBHOOK_SECRET: "",
    POSTHOG_API_KEY: "",
    POSTHOG_HOST: "",
    SENTRY_DSN: "",
    S3_ENDPOINT: "",
    S3_REGION: "",
    S3_BUCKET: "",
    S3_ACCESS_KEY_ID: "",
    S3_SECRET_ACCESS_KEY: "",
    S3_FILE_URL: "",
    DTC_RELEASE_MIGRATION_MODE: "",
    DTC_RELEASE_MIGRATION_CHILD_PROCESS: "",
    P14_AUTH_OBSERVER_ENABLED: "1",
    P14_AUTH_OBSERVER_PROTOCOL: "1",
    P14_AUTH_OBSERVER_ROLE: input.role,
    P14_AUTH_OBSERVER_RUN_ID: input.preload.runId,
    P14_AUTH_OBSERVER_TOKEN: input.token,
    P14_AUTH_OBSERVER_PARENT_PID: String(input.preload.parentPid),
    P14_AUTH_OBSERVER_CLI_PATH: input.preload.cliPath,
    P14_AUTH_OBSERVER_MEDUSA_PORT: String(input.port),
    P14_AUTH_OBSERVER_COUNTER_TABLE: input.preload.counterTable,
    P14_AUTH_OBSERVER_REDIS_NAMESPACE: input.preload.redisNamespace,
    P14_AUTH_OBSERVER_PG_ENTRY: input.preload.pgEntry,
  }
  delete env.NODE_OPTIONS
  delete env.JEST_WORKER_ID
  delete env.JEST_WORKER_UNIQUE_ID
  delete env.TEST_TYPE
  env.NODE_OPTIONS = `--require=${input.preload.file}`
  return env
}

async function reserveLoopbackPort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer()
    server.once("error", () => {
      reject(new AuthTestHarnessError("AUTH_TEST_WORKER_FAILED"))
    })
    server.listen(0, LOOPBACK_HOST, () => {
      const address = server.address()
      if (!address || typeof address === "string" || address.port <= 0) {
        server.close()
        reject(new AuthTestHarnessError("AUTH_TEST_WORKER_FAILED"))
        return
      }
      const port = address.port
      server.close((error) => {
        if (error) {
          reject(new AuthTestHarnessError("AUTH_TEST_WORKER_FAILED"))
          return
        }
        resolvePort(port)
      })
    })
  })
}

async function reserveDistinctLoopbackPorts(): Promise<[number, number]> {
  const first = await reserveLoopbackPort()
  let second = await reserveLoopbackPort()
  if (second === first) {
    second = await reserveLoopbackPort()
  }
  if (second === first || first === 6379 || second === 6379) {
    throw new AuthTestHarnessError("AUTH_TEST_WORKER_FAILED")
  }
  return [first, second]
}

function requestLoopback(
  port: number,
  path: string,
  timeoutMs = HTTP_PROBE_TIMEOUT_MS
): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolveRequest, reject) => {
    const req = http.get(
      {
        host: LOOPBACK_HOST,
        port,
        path,
        family: 4,
        timeout: timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on("data", (chunk) => {
          chunks.push(chunk)
        })
        res.on("end", () => {
          resolveRequest({
            statusCode: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
          })
        })
      }
    )
    req.on("timeout", () => {
      req.destroy()
      reject(new AuthTestHarnessError("AUTH_TEST_WORKER_TIMEOUT"))
    })
    req.on("error", () => {
      reject(new AuthTestHarnessError("AUTH_TEST_WORKER_FAILED"))
    })
  })
}

function parseJson(body: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(body) as unknown
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null
    }
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

function spawnMedusaProcess(input: {
  cliPath: string
  port: number
  databaseUrl: string
  databaseName: string
  redisUrl: string
  role: ObserverRole
  preload: ObserverPreload
}): MedusaHandle {
  const token = randomBytes(32).toString("hex")
  const child = spawn(
    process.execPath,
    [input.cliPath, "start", "--host", LOOPBACK_HOST, "--port", String(input.port)],
    {
      cwd: BACKEND_ROOT,
      env: buildMedusaChildEnv({
        port: input.port,
        databaseUrl: input.databaseUrl,
        databaseName: input.databaseName,
        redisUrl: input.redisUrl,
        role: input.role,
        token,
        preload: input.preload,
      }),
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    }
  )

  const pid = requirePositivePid(child.pid)
  const mailbox = attachMailbox(child)

  let captured = ""
  const append = (chunk: Buffer | string) => {
    captured += chunk.toString()
    if (captured.length > 200_000) {
      captured = captured.slice(-100_000)
    }
  }

  child.stdout?.on("data", append)
  child.stderr?.on("data", append)

  return {
    child,
    pid,
    port: input.port,
    role: input.role,
    token,
    mailbox,
    logs: () => captured,
  }
}

async function waitForObserverReady(
  handle: MedusaHandle,
  preload: ObserverPreload
): Promise<void> {
  const exitPromise = new Promise<Record<string, unknown>>((_, reject) => {
    const failOnExit = () => {
      if (logsIndicateAddressInUse(handle.logs())) {
        reject(new AuthTestHarnessError("AUTH_TEST_MEDUSA_EADDRINUSE"))
        return
      }
      reject(
        blocked(
          `AUTH_TEST_OBSERVER_EXIT:${handle.child.exitCode ?? handle.child.signalCode}:${summarizeChildLogs(handle.logs())}`
        )
      )
    }
    if (handle.child.exitCode !== null || handle.child.signalCode) {
      failOnExit()
      return
    }
    handle.child.once("exit", failOnExit)
  })

  const message = await Promise.race([
    handle.mailbox.waitFor(
      (incoming) => incoming.type === "observer-ready" && incoming.role === handle.role,
      OBSERVER_READY_TIMEOUT_MS,
      "AUTH_TEST_OBSERVER_READY_TIMEOUT"
    ),
    exitPromise,
  ])

  if (
    message.v !== 1 ||
    message.runId !== preload.runId ||
    message.origin !== OBSERVER_ORIGIN ||
    message.pid !== handle.pid ||
    message.ppid !== preload.parentPid
  ) {
    throw blocked("AUTH_TEST_OBSERVER_READY")
  }
}

function logsIndicateAddressInUse(logs: string): boolean {
  return /EADDRINUSE/i.test(logs)
}

function summarizeChildLogs(logs: string): string {
  const redacted = logs
    .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "postgres://[REDACTED]")
    .replace(/redis:\/\/[^\s]+/gi, "redis://[REDACTED]")
    .replace(/ioredis|event-bus-redis|bullmq|ECONNREFUSED[^\s]*6379/gi, "[redis]")
  const lines = redacted
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const interesting = lines.filter((line) =>
    /error|Error|exit|listen|ready|Cannot|failed|forbidden|invalid/i.test(line)
  )
  const chosen = (interesting.length > 0 ? interesting.slice(-6) : lines.slice(-4)).join(" | ")
  return chosen.replace(/[^\w :._()|/-]/g, "_").slice(0, 240)
}

async function waitUntilMedusaReady(
  handle: MedusaHandle,
  timeoutMs = MEDUSA_BOOT_TIMEOUT_MS
): Promise<{ live: LivePayload; ready: ReadyPayload }> {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    if (handle.child.exitCode !== null || handle.child.signalCode) {
      if (logsIndicateAddressInUse(handle.logs())) {
        throw new AuthTestHarnessError("AUTH_TEST_MEDUSA_EADDRINUSE")
      }
      throw blocked(
        `AUTH_TEST_MEDUSA_EXIT:${handle.child.exitCode ?? handle.child.signalCode}:${summarizeChildLogs(handle.logs())}`
      )
    }

    const health = await requestLoopback(handle.port, "/health").catch(
      () => null
    )
    if (health?.statusCode === 200) {
      const live = await requestLoopback(handle.port, "/health/live").catch(
        () => null
      )
      const livePayload = live?.statusCode === 200 ? parseJson(live.body) : null
      if (livePayload?.service === MEDUSA_LIVE_SERVICE) {
        const ready = await requestLoopback(handle.port, "/health/ready").catch(
          () => null
        )
        const readyPayload =
          ready?.statusCode === 200 ? parseJson(ready.body) : null
        const checks = readyPayload?.checks as ReadyPayload["checks"]
        if (
          readyPayload?.service === MEDUSA_LIVE_SERVICE &&
          checks?.postgres === "up" &&
          checks?.redis === "up"
        ) {
          return {
            live: livePayload as LivePayload,
            ready: readyPayload as ReadyPayload,
          }
        }
      }
    }

    await delay(500)
  }

  if (logsIndicateAddressInUse(handle.logs())) {
    throw new AuthTestHarnessError("AUTH_TEST_MEDUSA_EADDRINUSE")
  }
  throw blocked("AUTH_TEST_MEDUSA_BOOT_TIMEOUT")
}

async function startMedusaProcess(
  input: {
    cliPath: string
    port: number
    databaseUrl: string
    databaseName: string
    redisUrl: string
    role: ObserverRole
    preload: ObserverPreload
  },
  occupiedPorts: Set<number>,
  handles: MedusaHandle[]
): Promise<{ handle: MedusaHandle; live: LivePayload; ready: ReadyPayload }> {
  const handle = spawnMedusaProcess(input)
  handles.push(handle)
  try {
    await waitForObserverReady(handle, input.preload)
    const ready = await waitUntilMedusaReady(handle)
    occupiedPorts.add(handle.port)
    return { handle, ...ready }
  } catch (error) {
    if (
      error instanceof AuthTestHarnessError &&
      error.code === "AUTH_TEST_MEDUSA_EADDRINUSE"
    ) {
      await stopExactProcess(handle)
      let retryPort = await reserveLoopbackPort()
      if (retryPort === input.port || occupiedPorts.has(retryPort)) {
        retryPort = await reserveLoopbackPort()
      }
      if (retryPort === input.port || occupiedPorts.has(retryPort)) {
        throw blocked("AUTH_TEST_MEDUSA_EADDRINUSE")
      }
      const retry = spawnMedusaProcess({ ...input, port: retryPort })
      handles.push(retry)
      try {
        await waitForObserverReady(retry, input.preload)
        const ready = await waitUntilMedusaReady(retry)
        occupiedPorts.add(retry.port)
        return { handle: retry, ...ready }
      } catch (retryError) {
        throw retryError instanceof AuthTestHarnessError
          ? retryError
          : blocked("AUTH_TEST_MEDUSA_BOOT_FAILED")
      }
    }
    throw error instanceof AuthTestHarnessError
      ? error
      : blocked("AUTH_TEST_MEDUSA_BOOT_FAILED")
  }
}

async function waitForExit(child: ChildProcess, timeoutMs: number): Promise<void> {
  if (child.exitCode !== null || child.signalCode) {
    return
  }

  await new Promise<void>((resolveExit) => {
    const timer = setTimeout(() => resolveExit(), timeoutMs)
    child.once("exit", () => {
      clearTimeout(timer)
      resolveExit()
    })
  })
}

function isProcessGoneError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ESRCH"
  )
}

function assertExactPidGone(pid: number): void {
  try {
    process.kill(pid, 0)
  } catch (error) {
    if (isProcessGoneError(error)) {
      return
    }
    throw blocked("AUTH_TEST_MEDUSA_CLEANUP_PID")
  }
  throw blocked("AUTH_TEST_MEDUSA_CLEANUP_PID")
}

async function stopExactProcess(handle: MedusaHandle): Promise<void> {
  const pid = handle.pid
  if (!pid) {
    throw blocked("AUTH_TEST_MEDUSA_CLEANUP_PID")
  }

  const alreadyExited =
    handle.child.exitCode !== null || handle.child.signalCode !== null

  if (!alreadyExited) {
    try {
      process.kill(pid, "SIGTERM")
    } catch (error) {
      if (!isProcessGoneError(error)) {
        throw blocked("AUTH_TEST_MEDUSA_CLEANUP_PID")
      }
    }
    await waitForExit(handle.child, SIGTERM_WAIT_MS)
  }

  if (handle.child.exitCode === null && handle.child.signalCode === null) {
    try {
      process.kill(pid, "SIGKILL")
    } catch (error) {
      if (!isProcessGoneError(error)) {
        throw blocked("AUTH_TEST_MEDUSA_CLEANUP_PID")
      }
    }
    await waitForExit(handle.child, SIGKILL_WAIT_MS)
  }

  assertExactPidGone(pid)
}

async function stopExactProcesses(handles: MedusaHandle[]): Promise<void> {
  const seen = new Set<number>()
  let cleanupError: unknown
  for (const handle of handles) {
    if (seen.has(handle.pid)) {
      continue
    }
    seen.add(handle.pid)
    try {
      await stopExactProcess(handle)
    } catch (error) {
      cleanupError ??= error
    }
  }
  if (cleanupError) {
    throw cleanupError instanceof AuthTestHarnessError
      ? cleanupError
      : blocked("AUTH_TEST_MEDUSA_CLEANUP_PID")
  }
}

async function withParentRedisEmpty<T>(fn: () => Promise<T>): Promise<T> {
  const previous = PARENT_REDIS_KEYS.map(
    (key) => [key, process.env[key]] as const
  )
  for (const key of PARENT_REDIS_KEYS) {
    process.env[key] = ""
  }

  try {
    return await fn()
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  }
}

function pickFunction<T>(
  moduleValue: Record<string, unknown>,
  name: string
): T {
  const direct = moduleValue[name]
  if (typeof direct === "function") {
    return direct as T
  }
  const nested = moduleValue.default
  if (nested && typeof nested === "object") {
    const fromDefault = (nested as Record<string, unknown>)[name]
    if (typeof fromDefault === "function") {
      return fromDefault as T
    }
  }
  throw blocked(`AUTH_TEST_MEDUSA_MIGRATE_EXPORT_${name}`)
}

function describeThrown(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}:${error.message}`.slice(0, 180)
  }
  if (typeof error === "string") {
    return error.slice(0, 180)
  }
  if (error && typeof error === "object") {
    const record = error as {
      name?: unknown
      message?: unknown
      code?: unknown
    }
    return `${String(record.name)}:${String(record.message)}:${String(record.code)}`.slice(
      0,
      180
    )
  }
  return `${typeof error}:${String(error)}`.slice(0, 180)
}

function sanitizeMigrateError(error: unknown): string {
  return describeThrown(error)
    .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "postgres://[REDACTED]")
    .replace(/redis:\/\/[^\s]+/gi, "redis://[REDACTED]")
    .replace(/[^\w :._()-]/g, "_")
    .slice(0, 160)
}

function isHarnessError(error: unknown): error is AuthTestHarnessError {
  return (
    error instanceof AuthTestHarnessError ||
    (typeof error === "object" &&
      error !== null &&
      (error as { name?: unknown }).name === "AuthTestHarnessError")
  )
}

async function migrateDisposableMedusaSchema(databaseUrl: string): Promise<void> {
  const previousDatabaseUrl = process.env.DATABASE_URL
  const previousMigrationUrl = process.env.DATABASE_MIGRATION_URL
  await withParentRedisEmpty(async () => {
    process.env.DATABASE_URL = toMedusaDatabaseUrl(databaseUrl)
    process.env.DATABASE_MIGRATION_URL = process.env.DATABASE_URL

    const [{ asValue }, framework, { logger }, utils, migrations, testUtils] =
      await Promise.all([
        import("@medusajs/framework/awilix"),
        import("@medusajs/framework"),
        import("@medusajs/framework/logger"),
        import("@medusajs/framework/utils"),
        import("@medusajs/framework/migrations"),
        import("@medusajs/test-utils"),
      ]).catch((error) => {
        throw blocked(
          `AUTH_TEST_MEDUSA_MIGRATE_IMPORT:${sanitizeMigrateError(error)}`
        )
      })

    const { container, MedusaAppLoader } = framework
    const { ContainerRegistrationKeys, getResolvedPlugins, mergePluginModules } =
      utils
    const Migrator = pickFunction<
      new (input: { container: unknown }) => {
        ensureMigrationsTable: () => Promise<void>
      }
    >(migrations as Record<string, unknown>, "Migrator")
    const testUtilsRecord = testUtils as Record<string, unknown>
    const configLoaderOverride = pickFunction<
      (
        directory: string,
        override: { clientUrl: string; debug?: boolean }
      ) => Promise<void>
    >(testUtilsRecord, "configLoaderOverride")
    const initDb = pickFunction<
      () => Promise<{ destroy?: () => Promise<void> }>
    >(testUtilsRecord, "initDb")
    const migrateDatabase = pickFunction<(loader: unknown) => Promise<void>>(
      testUtilsRecord,
      "migrateDatabase"
    )
    const syncLinks = pickFunction<
      (
        loader: unknown,
        directory: string,
        container: unknown,
        logger: unknown
      ) => Promise<void>
    >(testUtilsRecord, "syncLinks")
    const clearInstances = pickFunction<() => Promise<void>>(
      testUtilsRecord,
      "clearInstances"
    )

    try {
      await configLoaderOverride(BACKEND_ROOT, {
        clientUrl: toMedusaDatabaseUrl(databaseUrl),
        debug: false,
      })
    } catch (error) {
      throw blocked(
        `AUTH_TEST_MEDUSA_MIGRATE_CONFIG:${sanitizeMigrateError(error)}`
      )
    }

    const appLoader = new MedusaAppLoader({
      medusaConfigPath: BACKEND_ROOT,
      cwd: BACKEND_ROOT,
    })

    try {
      if (
        typeof container.hasRegistration === "function" &&
        container.hasRegistration(ContainerRegistrationKeys.CONFIG_MODULE)
      ) {
        const configModule = container.resolve(
          ContainerRegistrationKeys.CONFIG_MODULE
        )
        const plugins = await getResolvedPlugins(BACKEND_ROOT, configModule)
        mergePluginModules(configModule, plugins)
      }

      container.register({
        [ContainerRegistrationKeys.LOGGER]: asValue(logger),
      })
    } catch (error) {
      throw blocked(
        `AUTH_TEST_MEDUSA_MIGRATE_LOADER:${sanitizeMigrateError(error)}`
      )
    }

    let pgConnection: { destroy?: () => Promise<void> } | undefined
    try {
      pgConnection = await withTimeout(
        initDb(),
        30_000,
        "AUTH_TEST_MEDUSA_MIGRATE_INITDB:timeout"
      )
    } catch (error) {
      throw blocked(
        `AUTH_TEST_MEDUSA_MIGRATE_INITDB:${sanitizeMigrateError(error)}`
      )
    }

    try {
      const migrator = new Migrator({ container })
      await withTimeout(
        (async () => {
          await migrator.ensureMigrationsTable()
          await migrateDatabase(appLoader)
          await syncLinks(appLoader, BACKEND_ROOT, container, logger)
          await clearInstances()
        })(),
        90_000,
        "AUTH_TEST_MEDUSA_MIGRATE_SCHEMA:timeout"
      )
    } catch (error) {
      if (error instanceof AuthTestHarnessError) {
        throw error
      }
      throw blocked(
        `AUTH_TEST_MEDUSA_MIGRATE_SCHEMA:${sanitizeMigrateError(error)}`
      )
    } finally {
      if (pgConnection && typeof pgConnection.destroy === "function") {
        await pgConnection.destroy()
      }
    }
  }).finally(() => {
    if (previousDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL
    } else {
      process.env.DATABASE_URL = previousDatabaseUrl
    }
    if (previousMigrationUrl === undefined) {
      delete process.env.DATABASE_MIGRATION_URL
    } else {
      process.env.DATABASE_MIGRATION_URL = previousMigrationUrl
    }
  })
}

function asReadyChecks(payload: ReadyPayload): TwoProcessReadyChecks {
  const postgres = payload.checks?.postgres === "up" ? "up" : "down"
  const redis = payload.checks?.redis === "up" ? "up" : "down"
  if (postgres !== "up" || redis !== "up") {
    throw blocked("AUTH_TEST_MEDUSA_NOT_READY")
  }
  return { postgres, redis }
}

async function readReadyChecks(port: number): Promise<TwoProcessReadyChecks> {
  const ready = await requestLoopback(port, "/health/ready")
  if (ready.statusCode !== 200) {
    throw blocked("AUTH_TEST_MEDUSA_NOT_READY")
  }
  const payload = parseJson(ready.body) as ReadyPayload | null
  if (payload?.service !== MEDUSA_LIVE_SERVICE) {
    throw blocked("AUTH_TEST_MEDUSA_NOT_READY")
  }
  return asReadyChecks(payload)
}

export async function runTwoProcessSharedStateProof(input: {
  postgres: AuthPostgresHarness
  redis: AuthRedisHarness
}): Promise<TwoProcessProofResult> {
  assertAuthTestHarness()

  const postgresBinding = getAuthPostgresTestBinding(input.postgres)
  const redisBinding = getAuthRedisTestBinding(input.redis)
  const databaseName = requireDisposableDatabaseName(postgresBinding.databaseName)
  const redisUrl = requireLoopbackRedis(redisBinding.host, redisBinding.port)
  const handles: MedusaHandle[] = []
  let preload: ObserverPreload | undefined

  try {
    const cliPath = resolveMedusaCli()
    try {
      await migrateDisposableMedusaSchema(postgresBinding.databaseUrl)
    } catch (error) {
      if (isHarnessError(error)) {
        throw error
      }
      throw blocked(
        `AUTH_TEST_MEDUSA_MIGRATE_FAILED:${sanitizeMigrateError(error)}`
      )
    }

    preload = await createObserverPreload({
      cliPath,
      counterTable: postgresBinding.counterTable,
      redisNamespace: redisBinding.namespace,
    })

    const [portA, portB] = await reserveDistinctLoopbackPorts()
    const occupiedPorts = new Set<number>([portA, portB])
    const spawnInput = {
      cliPath,
      databaseUrl: postgresBinding.databaseUrl,
      databaseName,
      redisUrl,
      preload,
    }

    const processA = await startMedusaProcess(
      { ...spawnInput, port: portA, role: "A" },
      occupiedPorts,
      handles
    )
    const processB = await startMedusaProcess(
      { ...spawnInput, port: portB, role: "B" },
      occupiedPorts,
      handles
    )

    if (
      processA.handle.pid === processB.handle.pid ||
      processA.handle.port === processB.handle.port ||
      processA.handle.port <= 0 ||
      processB.handle.port <= 0 ||
      processA.handle.pid === process.pid ||
      processB.handle.pid === process.pid
    ) {
      throw blocked("AUTH_TEST_MEDUSA_IDENTITY_FAILED")
    }

    asReadyChecks(processA.ready)
    asReadyChecks(processB.ready)
    if (
      processA.live.service !== MEDUSA_LIVE_SERVICE ||
      processB.live.service !== MEDUSA_LIVE_SERVICE
    ) {
      throw blocked("AUTH_TEST_MEDUSA_IDENTITY_FAILED")
    }

    await input.postgres.incrementSharedCounter()
    await input.postgres.incrementSharedCounter()
    await input.redis.setKey("shared", "1")
    await input.redis.setKey("shared", "2")

    const [readyAfterA, readyAfterB] = await Promise.all([
      readReadyChecks(processA.handle.port),
      readReadyChecks(processB.handle.port),
    ])

    const [observationA, observationB] = await Promise.all([
      observeFromMedusa(processA.handle, preload),
      observeFromMedusa(processB.handle, preload),
    ])

    if (
      observationA.pid !== processA.handle.pid ||
      observationB.pid !== processB.handle.pid ||
      observationA.pid === process.pid ||
      observationB.pid === process.pid ||
      observationA.origin !== OBSERVER_ORIGIN ||
      observationB.origin !== OBSERVER_ORIGIN ||
      observationA.postgres !== 2 ||
      observationB.postgres !== 2 ||
      observationA.redis !== "2" ||
      observationB.redis !== "2"
    ) {
      throw blocked("AUTH_TEST_SHARED_STATE_FAILED")
    }

    const result: TwoProcessProofResult = {
      processType: MEDUSA_PROCESS_TYPE,
      pids: [observationA.pid, observationB.pid],
      listeners: [
        { host: LOOPBACK_HOST, port: processA.handle.port },
        { host: LOOPBACK_HOST, port: processB.handle.port },
      ],
      redisNamespace: redisBinding.namespace,
      databaseName,
      postgresObserved: [observationA.postgres, observationB.postgres],
      cacheObserved: [observationA.redis, observationB.redis],
      observations: [observationA, observationB],
      observationOrigin: [observationA.origin, observationB.origin],
      liveService: MEDUSA_LIVE_SERVICE,
      readyChecks: [readyAfterA, readyAfterB],
    }

    return result
  } catch (error) {
    throw error instanceof AuthTestHarnessError
      ? error
      : blocked("AUTH_TEST_MEDUSA_BOOT_FAILED")
  } finally {
    let stopError: unknown
    let preloadError: unknown
    try {
      await stopExactProcesses(handles)
    } catch (error) {
      stopError = error
    }
    try {
      await removeObserverPreload(preload)
    } catch (error) {
      preloadError = error
    }
    const cleanupError = stopError ?? preloadError
    if (cleanupError) {
      throw cleanupError instanceof AuthTestHarnessError
        ? cleanupError
        : blocked("AUTH_TEST_MEDUSA_CLEANUP_PID")
    }
  }
}
