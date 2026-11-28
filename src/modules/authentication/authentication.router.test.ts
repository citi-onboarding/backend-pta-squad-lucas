import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { notFoundHandler, problemHandler } from "../../shared/http/problem.js";
import { createAuthenticationRouter } from "./authentication.router.js";
import {
  invalidCredentials,
  type AuthenticationService,
} from "./authentication.service.js";

const validBody = {
  email: "seller@example.test",
  password: "router-test-password",
  client: "mobile",
};

function createTestApp(signIn: AuthenticationService["signIn"]) {
  const app = express();
  app.use(express.json());
  app.use(
    "/api/v1/auth",
    createAuthenticationRouter({ signIn } as unknown as AuthenticationService),
  );
  app.use(notFoundHandler);
  app.use(problemHandler);
  return app;
}

describe("authentication sign-in route", () => {
  it.each([
    [
      "a missing password",
      { email: validBody.email, client: validBody.client },
    ],
    ["an email without @", { ...validBody, email: "not-an-email" }],
    ["an unknown client type", { ...validBody, client: "desktop" }],
    ["an unexpected property", { ...validBody, rememberMe: true }],
  ])(
    "answers 400 without signing in for a body with %s",
    async (_case, body) => {
      const signIn = vi.fn();

      const response = await request(createTestApp(signIn))
        .post("/api/v1/auth/login")
        .send(body);

      expect(response.status).toBe(400);
      expect(response.type).toBe("application/problem+json");
      expect(response.body).toMatchObject({
        title: "Validation Error",
        status: 400,
      });
      expect(response.body).not.toHaveProperty("accessToken");
      expect(response.headers).not.toHaveProperty("set-cookie");
      expect(signIn).not.toHaveBeenCalled();
    },
  );

  it("answers rejected credentials with 401 Problem Details and no credential", async () => {
    const signIn = vi.fn().mockRejectedValue(invalidCredentials());

    const response = await request(createTestApp(signIn))
      .post("/api/v1/auth/login")
      .send(validBody);

    expect(response.status).toBe(401);
    expect(response.type).toBe("application/problem+json");
    expect(response.body).toMatchObject({
      type: "about:blank",
      title: "Unauthorized",
      status: 401,
      detail: "Email or password is incorrect.",
    });
    expect(response.body).not.toHaveProperty("accessToken");
    expect(response.headers).not.toHaveProperty("set-cookie");
  });
});
