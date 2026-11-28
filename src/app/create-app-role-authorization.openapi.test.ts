import { describe, expect, it } from "vitest";

import "../modules/authentication/authentication.openapi.js";
import "../modules/erp-sync/erp-sync.openapi.js";
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

  it("keeps the synchronization status without security", () => {
    expect(
      document.paths?.["/api/v1/sync/status"]?.get?.security,
    ).toBeUndefined();
  });
});
