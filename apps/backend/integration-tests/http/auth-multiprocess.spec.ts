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

jest.setTimeout(180_000)

const JWT_SECRET = "j".repeat(64)
const BASE = new Date("2026-01-01T00:00:00.000Z")

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
`

const WORKER_SOURCE = String.raw`
const http = require("node:http");
const { Pool } = require("pg");
const {
  authorizeCustomerAuthAccess,
  createPostgresCustomerAuthAccessDatabase,
} = require("./src/modules/customer-auth/access-guard");

const pool = new Pool({ connectionString: process.env.P14_DATABASE_URL });
const database = createPostgresCustomerAuthAccessDatabase(pool);
let handlerCalls = 0;

const server = http.createServer(async (req, res) => {
  if (req.url === "/observation") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ handlerCalls, pid: process.pid }));
    return;
  }

  const outageDatabase = {
    query: async () => {
      throw new Error("synthetic database outage");
    },
  };
  const selectedDatabase =
    req.headers["x-test-database-outage"] === "1" ? outageDatabase : database;

  const authorization = Array.isArray(req.headers.authorization)
    ? req.headers.authorization[0]
    : req.headers.authorization;
  const result = await authorizeCustomerAuthAccess(selectedDatabase, authorization, {
    jwtSecret: process.env.P14_JWT_SECRET,
    now: new Date(process.env.P14_NOW),
  });

  if (!result.authorized) {
    res.writeHead(result.statusCode, { "content-type": "application/json" });
    res.end(JSON.stringify({ code: result.code }));
    return;
  }

  handlerCalls += 1;
  res.writeHead(204);
  res.end();
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
  let workers: Worker[] = []

  beforeAll(async () => {
    postgres = await createAuthPostgresHarness()
    redis = await createAuthRedisHarness()
    const binding = getAuthPostgresTestBinding(postgres)
    pool = new Pool({ connectionString: binding.databaseUrl })
    database = createPostgresCustomerAuthAccessDatabase(pool)
    await pool.query(schemaSql)
    workers = await Promise.all([
      startWorker(binding.databaseUrl),
      startWorker(binding.databaseUrl),
    ])
  })

  beforeEach(async () => {
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
        "drop table if exists auth_session_lineage; drop table if exists auth_credential_state"
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
    const result = await call(workers[0], token(), {
      "x-test-database-outage": "1",
    })
    const after = await observe(workers[0])

    expect(result).toEqual({
      status: 503,
      body: { code: "AUTH_TEMPORARILY_UNAVAILABLE" },
    })
    expect(after.handlerCalls).toBe(before.handlerCalls)
  })

  it("rejects revoke and version changes from process A in process B even with Redis empty or unavailable", async () => {
    const [processA, processB] = workers
    expect(processA.child.pid).not.toBe(processB.child.pid)
    expect((await call(processB, token())).status).toBe(204)

    await redis.setKey("synthetic-positive-access", "allow")
    await redis.flushNamespace()
    await pool.query("update auth_session_lineage set status = 'revoked'")
    const revoked = await call(processB, token())
    expect(revoked.status).toBe(401)

    await pool.query("update auth_session_lineage set status = 'active'")
    await pool.query("update auth_credential_state set credential_version = 2")
    redis.enableOutage()
    try {
      const versionBumped = await call(processB, token())
      expect(versionBumped.status).toBe(401)
      expect((await observe(processB)).handlerCalls).toBe(1)
    } finally {
      redis.disableOutage()
    }
  })
})
