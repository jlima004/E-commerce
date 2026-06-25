/**
 * PM2 ecosystem for Medusa production (server + worker).
 *
 * Parameterize deployment paths via APP_ROOT before starting PM2:
 *   export APP_ROOT=/srv/medusa/app
 *
 * APP_VERSION must be exported once by the deploy pipeline (commit SHA or release tag)
 * before build/start — never set a literal here.
 *
 * Secret values are loaded from the operator-managed environment file on the VPS;
 * this file references variable names only.
 */

const path = require("node:path")

const appRoot = process.env.APP_ROOT || "<APP_ROOT>"
const buildCwd = path.join(appRoot, "apps/backend/.medusa/server")

const sharedRuntimeEnv = {
  NODE_ENV: "production",
  DATABASE_URL: process.env.DATABASE_URL,
  REDIS_URL: process.env.REDIS_URL,
  CACHE_REDIS_URL: process.env.CACHE_REDIS_URL,
  EVENTS_REDIS_URL: process.env.EVENTS_REDIS_URL,
  WE_REDIS_URL: process.env.WE_REDIS_URL,
  APP_VERSION: process.env.APP_VERSION,
}

const sharedProcessOptions = {
  cwd: buildCwd,
  instances: 1,
  exec_mode: "fork",
  autorestart: true,
  max_restarts: 10,
  min_uptime: "10s",
  listen_timeout: 30000,
  kill_timeout: 15000,
  merge_logs: true,
  time: true,
}

module.exports = {
  apps: [
    {
      name: "medusa-server",
      script: path.join(buildCwd, "node_modules/.bin/medusa"),
      args: "start --host 127.0.0.1 --port 9000",
      ...sharedProcessOptions,
      env: {
        ...sharedRuntimeEnv,
        WORKER_MODE: "server",
        ADMIN_DISABLED: "false",
      },
    },
    {
      name: "medusa-worker",
      script: path.join(buildCwd, "node_modules/.bin/medusa"),
      args: "start",
      ...sharedProcessOptions,
      env: {
        ...sharedRuntimeEnv,
        WORKER_MODE: "worker",
        ADMIN_DISABLED: "true",
      },
    },
  ],
}
