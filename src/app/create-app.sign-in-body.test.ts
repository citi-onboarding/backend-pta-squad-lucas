import { Writable } from "node:stream";

import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { createTestEnvironment } from "../../tests/support/test-environment.js";
import type { Database } from "../shared/database/create-database.js";
import { createLogger } from "../shared/logging/logger.js";
import { createApp } from "./create-app.js";
import { createDefaultErpSyncService } from "./erp-sync-runtime.js";

const captured = vi.hoisted(() => ({ logs: "" }));

// Keeps the real logger and the real application wiring; only the log sink,
// an external output, is redirected to memory.
vi.mock("../shared/logging/logger.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../shared/logging/logger.js")>();
  return {
    createLogger: (environment: Parameters<typeof original.createLogger>[0]) =>
      original.createLogger(
        environment,
        new Writable({
          write(chunk, _encoding, callback) {
            captured.logs += String(chunk);
            callback();
          },
        }),
      ),
  };
});

const PASSWORD_MARKER = "fictitious-password-marker";

describe("sign-in with an unparseable body", () => {
  it("answers 400 Problem Details and keeps the body out of the logs", async () => {
    const environment = createTestEnvironment({ LOG_LEVEL: "info" });
    // The request must be rejected before any data access.
    const database = {} as Database;
    const erpSyncService = createDefaultErpSyncService({
      database,
      environment,
      logger: createLogger(environment),
    });
    const app = createApp({ database, environment, erpSyncService });

    const response = await request(app)
      .post("/api/v1/auth/login")
      .set("Content-Type", "application/json")
      .send(`{"password":"${PASSWORD_MARKER}",`);
    await new Promise((resolve) => setImmediate(resolve));

    // Positive control: without it, an empty capture would prove nothing.
    expect(captured.logs.includes("/api/v1/auth/login")).toBe(true);
    // Booleans only, so that a failure never prints the body or the logs.
    expect.soft(response.status).toBe(400);
    expect.soft(response.type).toBe("application/problem+json");
    expect.soft(response.text.includes(PASSWORD_MARKER)).toBe(false);
    expect.soft(captured.logs.includes(PASSWORD_MARKER)).toBe(false);
  });
});
