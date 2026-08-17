import { spawn, type ChildProcess } from "node:child_process"
import { request } from "node:http"
import { Pool } from "pg"
import {
  createAuthPostgresHarness,
  getAuthPostgresTestBinding,
  type AuthPostgresHarness,
} from "../helpers/auth-postgres"
import {
  createAuthRedisHarness,
  type AuthRedisHarness,
} from "../helpers/auth-redis"
import {
  authorizeCustomerAuthAccess,
  createPostgresCustomerAuthAccessDatabase,
  type CustomerAuthAccessDatabase,
} from "../../src/modules/customer-auth/access-guard"
import { issueCustomerAuthAccessToken } from "../../src/modules/customer-auth/jwt"
import {
  createPostgresAuthSessionDatabase,
  issueInitialAuthSession,
  type AuthSessionDatabase,
} from "../../src/modules/customer-auth/session"
import { InMemoryAtomicRateLimitStore } from "../../src/modules/customer-auth/security/rate-limit"
import {
  handleCustomerAuthRefresh,
} from "../../src/api/auth/token/refresh/route"
import {
  AUTH_SURFACE_LOCAL_OPERATIONS,
  AUTH_SURFACE_NATIVE_OPERATIONS,
} from "../../src/api/auth-surface/manifest"

jest.setTimeout(180_000)

const JWT_SECRET = "j".repeat(64)
const KEYRING = {
  active: { version: 1, secret: "k".repeat(64) },
  previous: [],
}
const BASE = new Date("2026-01-01T00:00:00.000Z")
const CUSTOMER_AUTH_REVOKE_PATH =
  "/auth/customer/emailpass/revoke-current-lineage"

type Worker = {
  child: ChildProcess
  port: number
}

type HttpResult = {
  status: number
  body: Record<string, unknown>
}

const schemaSql = `
create table auth_credential_state (
  id text primary key,
  auth_identity_id text not null,
  customer_id text not null,
  credential_version integer not null,
  operation_status text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index auth_guard_credential_identity
  on auth_credential_state(auth_identity_id) where deleted_at is null;

create table auth_session_lineage (
  id text primary key,
  sid text not null,
  auth_identity_id text not null,
  customer_id text not null,
  credential_version_snapshot integer not null,
  status text not null,
  version integer not null default 1,
  original_authenticated_at timestamptz not null,
  absolute_expires_at timestamptz not null,
  revoked_at timestamptz,
  revocation_reason text,
  expired_at timestamptz,
  schema_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index auth_guard_lineage_sid
  on auth_session_lineage(sid) where deleted_at is null;

create table auth_refresh_credential (
  id text primary key,
  lineage_id text not null,
  token_hash text not null,
  generation integer not null default 0,
  status text not null default 'active',
  replacement_id text,
  request_key_hash text,
  nonce text not null,
  key_version integer not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  recovery_until timestamptz,
  replacement_used_at timestamptz,
  replayed_at timestamptz,
  revoked_at timestamptz,
  schema_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index auth_guard_refresh_hash
  on auth_refresh_credential(token_hash) where deleted_at is null;
create unique index auth_guard_refresh_generation
  on auth_refresh_credential(lineage_id, generation) where deleted_at is null;
create unique index auth_guard_refresh_active
  on auth_refresh_credential(lineage_id)
  where status = 'active' and deleted_at is null;
`

const WORKER_SOURCE = String.raw`
const http = require("node:http");
const { Pool } = require("pg");
const {
  createCustomerAuthAccessGuardMiddleware,
} = require("./src/api/middlewares");
const {
  createPostgresAuthSessionDatabase,
  rotateAuthRefresh,
} = require("./src/modules/customer-auth/session");
const {
  POST: revokeCurrentLineage,
} = require("./src/api/auth/customer/emailpass/revoke-current-lineage/route");

const pool = new Pool({ connectionString: process.env.P14_DATABASE_URL });
const sessionDatabase = createPostgresAuthSessionDatabase(pool);
const REVOKE_PATH = "/auth/customer/emailpass/revoke-current-lineage";
const keyring = {
  active: { version: 1, secret: "kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk" },
  previous: [],
};
let handlerCalls = 0;

function replaceBindings(sql) {
  let index = 0;
  return sql.replace(/\?/g, () => "$" + (++index));
}

const connection = {
  raw(sql, bindings = []) {
    return pool.query(replaceBindings(sql), bindings);
  },
  async transaction(callback) {
    const client = await pool.connect();
    await client.query("begin");
    const transaction = {
      raw(sql, bindings = []) {
        return client.query(replaceBindings(sql), bindings);
      },
    };
    try {
      const result = await callback(transaction);
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  },
};

function createRequest(req, connectionForRequest) {
  return {
    method: req.method,
    originalUrl: req.url,
    url: req.url,
    path: (req.url || "").split(/[?#]/, 1)[0],
    baseUrl: "",
    headers: req.headers,
    body: undefined,
    scope: {
      resolve: () => connectionForRequest,
    },
  };
}

function createResponse(res) {
  const response = {
    headersSent: false,
    statusCode: 200,
    status(code) {
      response.statusCode = code;
      return response;
    },
    json(body) {
      if (response.headersSent) {
        return response;
      }
      response.headersSent = true;
      res.writeHead(response.statusCode, {
        "content-type": "application/json",
      });
      res.end(JSON.stringify(body));
      return response;
    },
    end() {
      if (response.headersSent) {
        return response;
      }
      response.headersSent = true;
      res.writeHead(response.statusCode);
      res.end();
      return response;
    },
  };
  return response;
}

async function invokeGuarded(request, response, handler, now) {
  let nextPromise = Promise.resolve();
  const guard = createCustomerAuthAccessGuardMiddleware({ now });
  await guard(request, response, () => {
    handlerCalls += 1;
    nextPromise = Promise.resolve(handler());
  });
  await nextPromise;
}

const server = http.createServer(async (req, res) => {
  if (req.url === "/observation") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ handlerCalls, pid: process.pid }));
    return;
  }

  const pathname = (req.url || "").split(/[?#]/, 1)[0];
  const connectionForRequest =
    req.headers["x-test-database-outage"] === "1"
      ? {
          raw: async () => {
            throw new Error("synthetic database outage");
          },
        }
      : connection;
  const requestedNow = Array.isArray(req.headers["x-test-now"])
    ? req.headers["x-test-now"][0]
    : req.headers["x-test-now"];
  const now = () =>
    new Date(requestedNow || process.env.P14_NOW);

  if (req.method === "POST" && pathname === REVOKE_PATH) {
    const request = createRequest(req, connectionForRequest);
    const response = createResponse(res);
    await invokeGuarded(
      request,
      response,
      () => revokeCurrentLineage(request, response),
      now
    );
    return;
  }

  if (req.method === "POST" && pathname === "/protected") {
    const request = createRequest(req, connectionForRequest);
    const response = createResponse(res);
    await invokeGuarded(
      request,
      response,
      () => response.status(204).end(),
      now
    );
    return;
  }

  if (req.url === "/refresh") {
    let body = "";
    req.on("data", chunk => { body += chunk.toString("utf8"); });
    req.on("end", async () => {
      try {
        const input = JSON.parse(body);
        const result = await rotateAuthRefresh(sessionDatabase, {
          refreshToken: input.refreshToken,
          idempotencyKey: input.idempotencyKey,
          keyring,
          jwtSecret: process.env.P14_JWT_SECRET,
          now: new Date(process.env.P14_NOW),
        });
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ refreshToken: result.refreshToken }));
      } catch {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ code: "AUTHENTICATION_REQUIRED" }));
      }
    });
    return;
  }

  if (req.url === "/version-bump") {
    await pool.query(
      "update auth_credential_state set credential_version = credential_version + 1"
    );
    res.writeHead(204);
    res.end();
    return;
  }

  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ code: "NOT_FOUND" }));
});

server.listen(0, "127.0.0.1", () => {
  process.send({ port: server.address().port, pid: process.pid });
});

process.on("message", async message => {
  if (message === "close") {
    server.close(async () => {
      await pool.end().catch(() => undefined);
      process.exit(0);
    });
  }
});
`

function at(milliseconds: number): Date {
  return new Date(BASE.getTime() + milliseconds)
}

function token(input: {
  authIdentityId?: string
  customerId?: string
  sid?: string
  credentialVersion?: number
  now?: Date
  originalAuthenticatedAt?: Date
  absoluteExpiresAt?: Date
  secret?: string
} = {}): string {
  return issueCustomerAuthAccessToken({
    secret: input.secret ?? JWT_SECRET,
    authIdentityId: input.authIdentityId ?? "identity_1",
    customerId: input.customerId ?? "customer_1",
    sid: input.sid ?? "sid_1",
    credentialVersion: input.credentialVersion ?? 1,
    originalAuthenticatedAt: input.originalAuthenticatedAt ?? BASE,
    absoluteExpiresAt:
      input.absoluteExpiresAt ?? at(30 * 24 * 60 * 60 * 1000),
    now: input.now ?? BASE,
  }).token
}

async function startWorker(databaseUrl: string): Promise<Worker> {
  const child = spawn(
    process.execPath,
    ["-r", "ts-node/register/transpile-only", "-e", WORKER_SOURCE],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_ENV: "test",
        P14_DATABASE_URL: databaseUrl,
        P14_JWT_SECRET: JWT_SECRET,
        JWT_SECRET,
        P14_NOW: at(60_000).toISOString(),
        TS_NODE_PROJECT: "tsconfig.json",
      },
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    }
  )

  const port = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("worker start timeout")), 20_000)
    child.once("message", (message) => {
      clearTimeout(timer)
      resolve(Number((message as { port: number }).port))
    })
    child.once("exit", (code) => {
      clearTimeout(timer)
      reject(new Error(`worker exited before ready: ${code}`))
    })
  })
  return { child, port }
}

async function stopWorker(worker: Worker): Promise<void> {
  if (worker.child.exitCode !== null) {
    return
  }
  worker.child.send?.("close")
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      worker.child.kill("SIGKILL")
      resolve()
    }, 5_000)
    worker.child.once("exit", () => {
      clearTimeout(timer)
      resolve()
    })
  })
}

function call(
  worker: Worker,
  accessToken: string,
  headers: Record<string, string> = {}
): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: "127.0.0.1",
        port: worker.port,
        method: "POST",
        path: "/protected",
        headers: {
          authorization: `Bearer ${accessToken}`,
          ...headers,
        },
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on("data", (chunk) => chunks.push(Buffer.from(chunk)))
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8")
          resolve({
            status: res.statusCode ?? 0,
            body: raw ? (JSON.parse(raw) as Record<string, unknown>) : {},
          })
        })
      }
    )
    req.once("error", reject)
    req.end()
  })
}

function postWorker(
  worker: Worker,
  path: string,
  body?: Record<string, unknown>,
  headers: Record<string, string> = {}
): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : ""
    const requestHeaders: Record<string, string> = { ...headers }
    if (payload) {
      requestHeaders["content-type"] = "application/json"
      requestHeaders["content-length"] = String(Buffer.byteLength(payload))
    }
    const req = request(
      {
        host: "127.0.0.1",
        port: worker.port,
        method: "POST",
        path,
        headers:
          Object.keys(requestHeaders).length > 0 ? requestHeaders : undefined,
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on("data", (chunk) => chunks.push(Buffer.from(chunk)))
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8")
          resolve({
            status: res.statusCode ?? 0,
            body: raw ? (JSON.parse(raw) as Record<string, unknown>) : {},
          })
        })
      }
    )
    req.once("error", reject)
    req.end(payload)
  })
}

function postRevoke(
  worker: Worker,
  accessToken: string,
  headers: Record<string, string> = {}
): Promise<HttpResult> {
  return postWorker(worker, CUSTOMER_AUTH_REVOKE_PATH, undefined, {
    authorization: `Bearer ${accessToken}`,
    ...headers,
  })
}

function responseRecorder() {
  const state: {
    statusCode: number
    body: unknown
    headers: Record<string, string>
  } = {
    statusCode: 200,
    body: undefined,
    headers: {},
  }
  const response = {
    headersSent: false,
    setHeader(name: string, value: string) {
      state.headers[name.toLowerCase()] = String(value)
      return response
    },
    status(code: number) {
      state.statusCode = code
      return response
    },
    json(body: unknown) {
      state.body = body
      return response
    },
    end() {
      return response
    },
  }
  return { response, state }
}

function observe(worker: Worker): Promise<{ handlerCalls: number; pid: number }> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: "127.0.0.1",
        port: worker.port,
        method: "GET",
        path: "/observation",
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on("data", (chunk) => chunks.push(Buffer.from(chunk)))
        res.on("end", () => {
          resolve(
            JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
              handlerCalls: number
              pid: number
            }
          )
        })
      }
    )
    req.once("error", reject)
    req.end()
  })
}

describe("Phase 14 PostgreSQL-authoritative access guard", () => {
  let postgres: AuthPostgresHarness
  let redis: AuthRedisHarness
  let pool: Pool
  let database: CustomerAuthAccessDatabase
  let sessionDatabase: AuthSessionDatabase
  let workers: Worker[] = []

  beforeAll(async () => {
    postgres = await createAuthPostgresHarness()
    redis = await createAuthRedisHarness()
    const binding = getAuthPostgresTestBinding(postgres)
    pool = new Pool({ connectionString: binding.databaseUrl })
    database = createPostgresCustomerAuthAccessDatabase(pool)
    sessionDatabase = createPostgresAuthSessionDatabase(pool)
    await pool.query(schemaSql)
    workers = await Promise.all([
      startWorker(binding.databaseUrl),
      startWorker(binding.databaseUrl),
    ])
  })

  beforeEach(async () => {
    await pool.query(
      "delete from auth_refresh_credential; delete from auth_session_lineage; delete from auth_credential_state"
    )
    await pool.query(
      `insert into auth_credential_state
         (id, auth_identity_id, customer_id, credential_version, operation_status)
       values ('credential_1', 'identity_1', 'customer_1', 1, 'stable')`
    )
    await pool.query(
      `insert into auth_session_lineage
         (id, sid, auth_identity_id, customer_id, credential_version_snapshot,
          status, original_authenticated_at, absolute_expires_at)
       values
         ('lineage_1', 'sid_1', 'identity_1', 'customer_1', 1,
          'active', $1, $2)`,
      [BASE, at(30 * 24 * 60 * 60 * 1000)]
    )
    await redis.flushNamespace()
  })

  afterAll(async () => {
    await Promise.all(workers.map(stopWorker))
    try {
      await pool?.query(
        "drop table if exists auth_refresh_credential; drop table if exists auth_session_lineage; drop table if exists auth_credential_state"
      )
    } finally {
      await pool?.end()
      await redis?.cleanup()
      await postgres?.cleanup()
    }
  })

  it("requires PostgreSQL lineage, ownership, credential version, deadline, and stable operation state", async () => {
    await expect(
      authorizeCustomerAuthAccess(database, `Bearer ${token()}`, {
        jwtSecret: JWT_SECRET,
        now: at(60_000),
      })
    ).resolves.toMatchObject({ authorized: true, lineageId: "lineage_1" })

    const cases: Array<[string, () => Promise<unknown>]> = [
      ["valid JWT with no lineage", () => pool.query("delete from auth_session_lineage")],
      [
        "identity mismatch",
        () =>
          pool.query(
            "update auth_session_lineage set auth_identity_id = 'identity_other'"
          ),
      ],
      [
        "customer mismatch",
        () =>
          pool.query(
            "update auth_session_lineage set customer_id = 'customer_other'"
          ),
      ],
      [
        "credential version mismatch",
        () =>
          pool.query(
            "update auth_credential_state set credential_version = 2"
          ),
      ],
      [
        "revoked lineage",
        () => pool.query("update auth_session_lineage set status = 'revoked'"),
      ],
      [
        "non-stable operation",
        () =>
          pool.query(
            "update auth_credential_state set operation_status = 'claimed'"
          ),
      ],
      [
        "inconsistent duplicate ownership",
        () =>
          pool.query(
            "update auth_credential_state set customer_id = 'customer_other'"
          ),
      ],
    ]

    for (const [, mutate] of cases) {
      await pool.query(
        "delete from auth_session_lineage; delete from auth_credential_state"
      )
      await pool.query(
        `insert into auth_credential_state
           (id, auth_identity_id, customer_id, credential_version, operation_status)
         values ('credential_1', 'identity_1', 'customer_1', 1, 'stable')`
      )
      await pool.query(
        `insert into auth_session_lineage
           (id, sid, auth_identity_id, customer_id, credential_version_snapshot,
            status, original_authenticated_at, absolute_expires_at)
         values ('lineage_1', 'sid_1', 'identity_1', 'customer_1', 1,
                 'active', $1, $2)`,
        [BASE, at(30 * 24 * 60 * 60 * 1000)]
      )
      await mutate()
      await expect(
        authorizeCustomerAuthAccess(database, `Bearer ${token()}`, {
          jwtSecret: JWT_SECRET,
          now: at(60_000),
        })
      ).resolves.toMatchObject({
        authorized: false,
        statusCode: 401,
        code: "AUTHENTICATION_REQUIRED",
      })
    }

    await expect(
      authorizeCustomerAuthAccess(database, `Bearer ${token()}`, {
        jwtSecret: JWT_SECRET,
        now: at(30 * 24 * 60 * 60 * 1000),
      })
    ).resolves.toMatchObject({
      authorized: false,
      statusCode: 401,
      code: "AUTHENTICATION_REQUIRED",
    })
  })

  it("fails closed on database outage before the handler", async () => {
    const before = await observe(workers[0])
    const result = await postRevoke(workers[0], token(), {
      "x-test-database-outage": "1",
    })
    const after = await observe(workers[0])

    expect(result.status).toBe(503)
    expect(result.body).toMatchObject({
      code: "AUTH_TEMPORARILY_UNAVAILABLE",
    })
    expect(after.handlerCalls).toBe(before.handlerCalls)
  })

  it("applies ownership, cv, stable, deadline, and JWT checks before revoke", async () => {
    const cases: Array<{
      mutate: () => Promise<unknown>
      accessToken?: string
      headers?: Record<string, string>
    }> = [
      {
        mutate: () => pool.query("delete from auth_session_lineage"),
      },
      {
        mutate: () =>
          pool.query(
            "update auth_session_lineage set auth_identity_id = 'identity_other'"
          ),
      },
      {
        mutate: () =>
          pool.query(
            "update auth_session_lineage set customer_id = 'customer_other'"
          ),
      },
      {
        mutate: () =>
          pool.query(
            "update auth_credential_state set credential_version = 2"
          ),
      },
      {
        mutate: () =>
          pool.query(
            "update auth_credential_state set operation_status = 'claimed'"
          ),
      },
      {
        mutate: async () => undefined,
        headers: {
          "x-test-now": at(30 * 24 * 60 * 60 * 1000).toISOString(),
        },
      },
      {
        mutate: async () => undefined,
        accessToken: token({ secret: "x".repeat(64) }),
      },
    ]

    for (const testCase of cases) {
      await pool.query(
        "delete from auth_refresh_credential; delete from auth_session_lineage; delete from auth_credential_state"
      )
      await pool.query(
        `insert into auth_credential_state
           (id, auth_identity_id, customer_id, credential_version, operation_status)
         values ('credential_1', 'identity_1', 'customer_1', 1, 'stable')`
      )
      await pool.query(
        `insert into auth_session_lineage
           (id, sid, auth_identity_id, customer_id, credential_version_snapshot,
            status, original_authenticated_at, absolute_expires_at)
         values ('lineage_1', 'sid_1', 'identity_1', 'customer_1', 1,
                 'active', $1, $2)`,
        [BASE, at(30 * 24 * 60 * 60 * 1000)]
      )
      await testCase.mutate()

      const before = await observe(workers[0])
      const result = await postRevoke(
        workers[0],
        testCase.accessToken ?? token(),
        testCase.headers
      )
      const after = await observe(workers[0])

      expect(result.status).toBe(401)
      expect(after.handlerCalls).toBe(before.handlerCalls)
    }
  })

  it("keeps revoke idempotent across processes while normal access stays denied", async () => {
    const [processA, processB] = workers
    expect(processA.child.pid).not.toBe(processB.child.pid)
    const accessToken = token()

    await redis.setKey("synthetic-positive-access", "allow")
    await redis.flushNamespace()
    expect((await postRevoke(processA, accessToken)).status).toBe(204)
    expect((await postRevoke(processB, accessToken)).status).toBe(204)

    const revoked = await call(processB, accessToken)
    expect(revoked.status).toBe(401)

    await pool.query("update auth_session_lineage set status = 'active'")
    await pool.query("update auth_credential_state set credential_version = 2")
    redis.enableOutage()
    try {
      const before = await observe(processB)
      const versionBumped = await call(processB, token())
      expect(versionBumped.status).toBe(401)
      expect((await observe(processB)).handlerCalls).toBe(before.handlerCalls)
    } finally {
      redis.disableOutage()
    }
  })

  it("enables the exact cumulative Phase 14 auth operations including refresh and revoke", () => {
    const enabledLocal = AUTH_SURFACE_LOCAL_OPERATIONS.filter(
      (entry) => entry.runtimePolicy === "PHASE14_ENABLED"
    ).map((entry) => `${entry.method} ${entry.pathTemplate}`)

    expect(enabledLocal).toEqual([
      "POST /auth/customer/emailpass/register",
      "POST /auth/customer/emailpass",
      "POST /auth/token/refresh",
      "POST /auth/customer/emailpass/revoke-current-lineage",
    ])
    expect(
      AUTH_SURFACE_NATIVE_OPERATIONS.every(
        (entry) => entry.runtimePolicy === "DENY"
      )
    ).toBe(true)
    expect(
      AUTH_SURFACE_NATIVE_OPERATIONS.find(
        (entry) => entry.pathTemplate === "/auth/token/refresh"
      )?.runtimePolicy
    ).toBe("DENY")
    expect(
      AUTH_SURFACE_NATIVE_OPERATIONS.filter((entry) =>
        ["/auth/session", "/auth/token/refresh"].includes(entry.pathTemplate)
      ).every((entry) => entry.runtimePolicy === "DENY")
    ).toBe(true)
  })

  it("requires refresh capability, Idempotency-Key, and an exactly empty body", async () => {
    const attempts = [
      {
        headers: {
          "idempotency-key": "request-1",
          "content-length": "0",
        },
        body: {},
      },
      {
        headers: {
          "x-indicio-refresh-token": "x".repeat(43),
          "content-length": "0",
        },
        body: {},
      },
      {
        headers: {
          "x-indicio-refresh-token": "x".repeat(43),
          "idempotency-key": "request-1",
          "content-length": "2",
        },
        body: {},
      },
    ]

    for (const attempt of attempts) {
      const { response, state } = responseRecorder()
      await handleCustomerAuthRefresh(
        {
          headers: attempt.headers,
          body: attempt.body,
          ip: "198.51.100.10",
        } as never,
        response as never,
        {
          database: sessionDatabase,
          keyring: KEYRING,
          jwtSecret: JWT_SECRET,
          rateLimitStore: new InMemoryAtomicRateLimitStore(),
          now: () => at(60_000),
          timing: async () => 0,
          resolveCustomer: async () => ({
            id: "customer_1",
            email: "synthetic@example.invalid",
            firstName: "Synthetic",
            lastName: "Customer",
            verificationState: "pending",
          }),
        }
      )
      expect(state.statusCode).toBe(400)
      expect(state.body).toMatchObject({ code: "INVALID_REQUEST" })
    }
  })

  it("rotates through refresh and reaches guarded revoke idempotently with 204", async () => {
    await pool.query(
      "delete from auth_refresh_credential; delete from auth_session_lineage"
    )
    const initial = await issueInitialAuthSession(sessionDatabase, {
      authIdentityId: "identity_1",
      customerId: "customer_1",
      credentialVersion: 1,
      keyring: KEYRING,
      jwtSecret: JWT_SECRET,
      now: BASE,
      idFactory: (prefix) =>
        prefix === "authlin"
          ? "lineage_1"
          : prefix === "authsid"
            ? "sid_1"
            : "refresh_1",
    })

    const refreshResponse = responseRecorder()
    await handleCustomerAuthRefresh(
      {
        headers: {
          "x-indicio-refresh-token": initial.refreshToken,
          "idempotency-key": "request-1",
          "content-length": "0",
        },
        body: {},
        ip: "198.51.100.10",
      } as never,
      refreshResponse.response as never,
      {
        database: sessionDatabase,
        keyring: KEYRING,
        jwtSecret: JWT_SECRET,
        rateLimitStore: new InMemoryAtomicRateLimitStore(),
        now: () => at(60_000),
        timing: async () => 0,
        resolveCustomer: async () => ({
          id: "customer_1",
          email: "synthetic@example.invalid",
          firstName: "Synthetic",
          lastName: "Customer",
          verificationState: "pending",
        }),
      }
    )
    expect(refreshResponse.state.statusCode).toBe(200)
    expect(refreshResponse.state.body).toMatchObject({
      customer: { id: "customer_1" },
      verificationState: "pending",
    })

    const beforeA = await observe(workers[0])
    const beforeB = await observe(workers[1])
    const firstRevoke = await postRevoke(workers[0], initial.accessToken)
    const repeatedRevoke = await postRevoke(workers[1], initial.accessToken)

    expect(firstRevoke.status).toBe(204)
    expect(repeatedRevoke.status).toBe(204)
    expect((await observe(workers[0])).handlerCalls).toBe(
      beforeA.handlerCalls + 1
    )
    expect((await observe(workers[1])).handlerCalls).toBe(
      beforeB.handlerCalls + 1
    )

    const beforeDeniedOperation = await observe(workers[1])
    expect((await call(workers[1], initial.accessToken)).status).toBe(401)
    expect((await observe(workers[1])).handlerCalls).toBe(
      beforeDeniedOperation.handlerCalls
    )
  })

  it("proves logout, replay, version bump, and deadline rejection across processes", async () => {
    const [processA, processB] = workers
    await pool.query(
      "delete from auth_refresh_credential; delete from auth_session_lineage"
    )
    await pool.query(
      "update auth_credential_state set credential_version = 1, operation_status = 'stable'"
    )
    const initial = await issueInitialAuthSession(sessionDatabase, {
      authIdentityId: "identity_1",
      customerId: "customer_1",
      credentialVersion: 1,
      keyring: KEYRING,
      jwtSecret: JWT_SECRET,
      now: BASE,
      idFactory: (prefix) =>
        prefix === "authlin"
          ? "lineage_1"
          : prefix === "authsid"
            ? "sid_1"
            : "refresh_1",
    })

    expect((await postRevoke(processA, initial.accessToken)).status).toBe(204)
    expect((await postRevoke(processB, initial.accessToken)).status).toBe(204)
    expect((await call(processB, initial.accessToken)).status).toBe(401)

    await pool.query(
      "delete from auth_refresh_credential; delete from auth_session_lineage"
    )
    const replaySession = await issueInitialAuthSession(sessionDatabase, {
      authIdentityId: "identity_1",
      customerId: "customer_1",
      credentialVersion: 1,
      keyring: KEYRING,
      jwtSecret: JWT_SECRET,
      now: BASE,
      idFactory: (prefix) =>
        prefix === "authlin"
          ? "lineage_1"
          : prefix === "authsid"
            ? "sid_1"
            : "refresh_1",
    })
    expect(
      (
        await postWorker(processA, "/refresh", {
          refreshToken: replaySession.refreshToken,
          idempotencyKey: "request-a",
        })
      ).status
    ).toBe(200)
    expect(
      (
        await postWorker(processA, "/refresh", {
          refreshToken: replaySession.refreshToken,
          idempotencyKey: "request-b",
        })
      ).status
    ).toBe(401)
    expect((await call(processB, replaySession.accessToken)).status).toBe(401)

    await pool.query(
      `update auth_session_lineage
          set status = 'active', revoked_at = null, revocation_reason = null`
    )
    expect((await postWorker(processA, "/version-bump")).status).toBe(204)
    expect((await call(processB, replaySession.accessToken)).status).toBe(401)

    await pool.query(
      "update auth_credential_state set credential_version = 1"
    )
    const beforeDeadline = await observe(processB)
    const deadline = await call(processB, replaySession.accessToken, {
      "x-test-now": replaySession.absoluteExpiresAt.toISOString(),
    })
    const afterDeadline = await observe(processB)
    expect(deadline.status).toBe(401)
    expect(afterDeadline.handlerCalls).toBe(beforeDeadline.handlerCalls)
  })
})
