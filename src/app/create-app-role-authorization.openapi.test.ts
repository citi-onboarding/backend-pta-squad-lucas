import { describe, expect, it } from "vitest";

import "./create-app.js";
import { createOpenApiDocument } from "../shared/http/openapi.js";

const problem = {
  "application/problem+json": {
    schema: { $ref: "#/components/schemas/Problem" },
  },
};

describe("administrator access API description", () => {
  const document = createOpenApiDocument();

  it.each([
    ["/api/v1/sync/runs", "get"],
    ["/api/v1/sync/run", "post"],
  ] as const)("documents %s %s", (path, method) => {
    const operation = document.paths?.[path]?.[method];

    expect
      .soft(operation?.security)
      .toEqual([{ bearerAuth: [] }, { cookieAuth: [] }]);
    expect.soft(operation?.responses).toMatchObject({
      401: { content: problem },
      403: { content: problem },
    });
  });

  it.each([
    ["/api/v1/users", "get"],
    ["/api/v1/users", "post"],
    ["/api/v1/users/{userId}/invitations", "post"],
    ["/api/v1/users/erp-seller-names", "get"],
  ] as const)("documents the user operation %s %s", (path, method) => {
    const operation = document.paths?.[path]?.[method];

    expect(operation).toBeDefined();
    expect
      .soft(operation?.security)
      .toEqual([{ bearerAuth: [] }, { cookieAuth: [] }]);
    expect.soft(operation?.responses).toMatchObject({
      401: { content: problem },
      403: { content: problem },
    });
  });

  // Registered by the public invitation router (cycle 3).
  it.each([
    ["/api/v1/invitations/lookup", "post"],
    ["/api/v1/invitations/accept", "post"],
  ] as const)("documents %s %s without security", (path, method) => {
    const operation = document.paths?.[path]?.[method];

    expect(operation).toBeDefined();
    expect(operation?.security).toBeUndefined();
  });

  it("keeps the synchronization status without security", () => {
    expect(
      document.paths?.["/api/v1/sync/status"]?.get?.security,
    ).toBeUndefined();
  });
});
