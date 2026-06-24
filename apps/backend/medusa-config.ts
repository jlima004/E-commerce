import { defineConfig } from "@medusajs/framework/utils"
import { env } from "./src/config/env"
import {
  buildRedisModules,
  resolveProjectRedisUrl,
} from "./src/infrastructure/redis-config"

const projectRedisUrl = resolveProjectRedisUrl(env)

module.exports = defineConfig({
  admin: {
    path: "/app",
    backendUrl: env.API_PUBLIC_URL,
    disable: env.ADMIN_DISABLED,
  },
  projectConfig: {
    databaseUrl: env.DATABASE_URL,
    workerMode: env.WORKER_MODE,
    ...(projectRedisUrl ? { redisUrl: projectRedisUrl } : {}),
    http: {
      storeCors: env.STORE_CORS,
      adminCors: env.ADMIN_CORS,
      authCors: env.AUTH_CORS,
      jwtSecret: env.JWT_SECRET,
      cookieSecret: env.COOKIE_SECRET,
    },
  },
  modules: [...buildRedisModules(env)],
})
