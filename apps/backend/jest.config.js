const { loadEnv } = require("@medusajs/utils");

const dbTempName = (process.env.DB_TEMP_NAME ?? "").trim();
const databaseUrl = (process.env.DATABASE_URL ?? "").trim();
const hasDisposableContext =
  dbTempName.length > 0 && databaseUrl.length > 0;

loadEnv("test", process.cwd());

module.exports = {
  transform: {
    "^.+\\.[jt]s$": [
      "@swc/jest",
      {
        jsc: {
          parser: { syntax: "typescript", decorators: true },
        },
      },
    ],
  },
  testEnvironment: "node",
  moduleFileExtensions: ["js", "ts", "json"],
  modulePathIgnorePatterns: ["dist/", "<rootDir>/.medusa/"],
  setupFiles: ["./integration-tests/setup.js"],
};

if (process.env.TEST_TYPE === "integration:http") {
  module.exports.testMatch = ["**/integration-tests/http/*.spec.[jt]s"];
  if (!hasDisposableContext) {
    module.exports.testPathIgnorePatterns = [
      "<rootDir>/integration-tests/http/auth-multiprocess\\.spec\\.[jt]s$",
    ];
  }
} else if (process.env.TEST_TYPE === "integration:modules") {
  module.exports.testMatch = ["**/src/modules/*/__tests__/**/*.spec.[jt]s"];

  if (hasDisposableContext) {
    module.exports.testMatch.push(
      "<rootDir>/integration-tests/modules/**/*.spec.[jt]s"
    );
  }
} else if (process.env.TEST_TYPE === "unit") {
  module.exports.testMatch = ["**/src/**/__tests__/**/*.unit.spec.[jt]s"];
}
