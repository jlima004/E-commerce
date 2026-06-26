import { defineConfig } from "@medusajs/framework/utils"
import { env } from "./src/config/env"
import {
  buildRedisModules,
  redisOptionsForUrl,
  resolveProjectRedisUrl,
} from "./src/infrastructure/redis-config"
import { buildStorageModule } from "./src/infrastructure/storage-config"
import { medusaLogger } from "./src/observability/medusa-logger"

const projectRedisUrl = resolveProjectRedisUrl(env)
const projectRedisOptions = redisOptionsForUrl(projectRedisUrl)

module.exports = defineConfig({
  logger: medusaLogger,
  admin: {
    path: "/app",
    backendUrl: env.API_PUBLIC_URL,
    disable: env.ADMIN_DISABLED,
  },
  projectConfig: {
    databaseUrl: env.DATABASE_URL,
    workerMode: env.WORKER_MODE,
    ...(projectRedisUrl ? { redisUrl: projectRedisUrl } : {}),
    ...(projectRedisOptions ? { redisOptions: projectRedisOptions } : {}),
    http: {
      storeCors: env.STORE_CORS,
      adminCors: env.ADMIN_CORS,
      authCors: env.AUTH_CORS,
      jwtSecret: env.JWT_SECRET,
      cookieSecret: env.COOKIE_SECRET,
    },
  },
  modules: [...buildRedisModules(env), ...buildStorageModule(env)],
})
