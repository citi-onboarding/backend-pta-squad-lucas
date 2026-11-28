import type { Environment } from "../../src/shared/config/env.js";

// One valid environment for tests that build the app. Nothing here is a real
// secret, and ERP synchronization is off so no test can reach the ERP.
export function createTestEnvironment(
  overrides: Partial<Environment> = {},
): Environment {
  return {
    NODE_ENV: "test",
    SERVER_HOST: "0.0.0.0",
    SERVER_PORT: 3001,
    LOG_LEVEL: "silent",
    CORS_ORIGINS: "http://localhost:5173",
    DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/test",
    ERP_API_URL: "https://erp.example.invalid",
    ERP_API_KEY: "fake-erp-key-for-tests",
    ERP_REQUEST_TIMEOUT_MS: 60_000,
    ERP_SYNC_ENABLED: false,
    ADMIN_API_TOKEN: undefined,
    corsOrigins: ["http://localhost:5173"],
    ...overrides,
  };
}
