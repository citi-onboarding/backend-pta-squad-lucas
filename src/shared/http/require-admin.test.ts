import { Writable } from "node:stream";

import express from "express";
import { pinoHttp } from "pino-http";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { createLogger } from "../logging/logger.js";
import { notFoundHandler, problemHandler } from "./problem.js";
import { createBearerTokenRecognizer, requireAdmin } from "./require-admin.js";
import type { AdminRecognizer } from "./require-admin.js";

const token = "invented-admin-token-0123456789-abcdef";

function createTestApp(recognizer: AdminRecognizer, destination?: Writable) {
  const reached = vi.fn();
  const app = express();
  if (destination) {
    app.use(
      pinoHttp({ logger: createLogger({ LOG_LEVEL: "info" }, destination) }),
    );
  }
  app.get("/admin-only", requireAdmin(recognizer), (_request, response) => {
    reached();
    response.json({ ok: true });
  });
  app.use(notFoundHandler);
  app.use(problemHandler);
  return { app, reached };
}

function captureOutput() {
  const captured = { output: "" };
  const destination = new Writable({
    write(chunk, _encoding, callback) {
      captured.output += chunk.toString();
      callback();
    },
  });
  return { captured, destination };
}

describe("requireAdmin with the bearer token recognizer", () => {
  it("lets a request with the configured token reach the endpoint", async () => {
    const { app, reached } = createTestApp(createBearerTokenRecognizer(token));

    const response = await request(app)
      .get("/admin-only")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
    expect(reached).toHaveBeenCalledTimes(1);
  });

  it("answers 401 as a problem response without a credential", async () => {
    const { app, reached } = createTestApp(createBearerTokenRecognizer(token));

    const response = await request(app).get("/admin-only");

    expect(response.status).toBe(401);
    expect(response.headers["content-type"]).toContain(
      "application/problem+json",
    );
    expect(response.headers["www-authenticate"]).toBe("Bearer");
    expect(response.body).toMatchObject({ status: 401 });
    expect(reached).not.toHaveBeenCalled();
  });

  it.each([
    ["a token that differs by one character", `${token.slice(0, -1)}X`],
    ["a shorter token", token.slice(0, -5)],
    ["a longer token", `${token}extra`],
    ["an empty token", ""],
  ])("answers 401 for %s", async (_label, wrongToken) => {
    const { app, reached } = createTestApp(createBearerTokenRecognizer(token));

    const response = await request(app)
      .get("/admin-only")
      .set("Authorization", `Bearer ${wrongToken}`);

    expect(response.status).toBe(401);
    expect(response.headers["www-authenticate"]).toBe("Bearer");
    expect(reached).not.toHaveBeenCalled();
  });

  it.each([
    ["the Basic scheme", `Basic ${token}`],
    ["a bearer value with extra parts", `Bearer ${token} extra`],
    ["the token without a scheme", token],
  ])("answers 401 for %s", async (_label, header) => {
    const { app, reached } = createTestApp(createBearerTokenRecognizer(token));

    const response = await request(app)
      .get("/admin-only")
      .set("Authorization", header);

    expect(response.status).toBe(401);
    expect(reached).not.toHaveBeenCalled();
  });

  it("refuses every request when no token is configured", async () => {
    const { app, reached } = createTestApp(
      createBearerTokenRecognizer(undefined),
    );

    const withToken = await request(app)
      .get("/admin-only")
      .set("Authorization", `Bearer ${token}`);
    const withEmptyToken = await request(app)
      .get("/admin-only")
      .set("Authorization", "Bearer ");
    const withoutHeader = await request(app).get("/admin-only");

    expect(withToken.status).toBe(401);
    expect(withEmptyToken.status).toBe(401);
    expect(withoutHeader.status).toBe(401);
    expect(reached).not.toHaveBeenCalled();
  });

  it("keeps the token out of response bodies", async () => {
    const { app } = createTestApp(createBearerTokenRecognizer(token));

    const valid = await request(app)
      .get("/admin-only")
      .set("Authorization", `Bearer ${token}`);
    const invalid = await request(app)
      .get("/admin-only")
      .set("Authorization", `Bearer ${token}X`);

    expect(JSON.stringify(valid.body)).not.toContain(token);
    expect(JSON.stringify(invalid.body)).not.toContain(token);
    expect(invalid.status).toBe(401);
  });

  // Regression guard: the logger already redacts the authorization header, so
  // this part passes by design once the guard works. It protects the guard from
  // ever logging the token itself.
  it("keeps the token out of log output", async () => {
    const { captured, destination } = captureOutput();
    const { app } = createTestApp(
      createBearerTokenRecognizer(token),
      destination,
    );

    const valid = await request(app)
      .get("/admin-only")
      .set("Authorization", `Bearer ${token}`);
    const invalid = await request(app)
      .get("/admin-only")
      .set("Authorization", `Bearer ${token}X`);
    await new Promise((resolve) => setImmediate(resolve));

    expect(valid.status).toBe(200);
    expect(invalid.status).toBe(401);
    expect(captured.output).not.toContain(token);
  });
});

describe("requireAdmin with a replaced recognizer", () => {
  it("lets through what the recognizer accepts and refuses the rest", async () => {
    const recognizer: AdminRecognizer = (incoming) =>
      Promise.resolve(incoming.get("x-test-admin") === "yes");
    const { app, reached } = createTestApp(recognizer);

    const accepted = await request(app)
      .get("/admin-only")
      .set("x-test-admin", "yes");
    const refused = await request(app)
      .get("/admin-only")
      .set("x-test-admin", "no");

    expect(accepted.status).toBe(200);
    expect(refused.status).toBe(401);
    expect(reached).toHaveBeenCalledTimes(1);
  });
});

describe("requireAdmin when the recognizer fails", () => {
  const secret = "secret-detail-from-the-recognizer-must-not-leak";

  it.each([
    [
      "throws synchronously",
      (): boolean => {
        throw new Error(secret);
      },
    ],
    ["rejects", () => Promise.reject(new Error(secret))],
  ])(
    "denies access and leaks no detail when the recognizer %s",
    async (_label, recognizer) => {
      const { captured, destination } = captureOutput();
      const { app, reached } = createTestApp(recognizer, destination);

      const response = await request(app)
        .get("/admin-only")
        .set("Authorization", `Bearer ${token}`);
      await new Promise((resolve) => setImmediate(resolve));

      // Fail closed: the endpoint is never reached and the answer is an error.
      expect(reached).not.toHaveBeenCalled();
      expect(response.status).toBe(500);
      expect(response.headers["content-type"]).toContain(
        "application/problem+json",
      );
      expect(response.text).not.toContain(secret);
      expect(response.text).not.toContain("Error:");
      expect(response.text).not.toContain("at ");
      expect(response.text).not.toContain(token);
      expect(captured.output).not.toContain(token);
    },
  );
});
