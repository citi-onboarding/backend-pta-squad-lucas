import { describe, expect, it } from "vitest";

import { createOpenApiDocument } from "../../shared/http/openapi.js";
import "./authentication.openapi.js";

interface DocumentedSchema {
  $ref?: string;
  required?: string[];
  properties?: Record<string, unknown>;
}

interface DocumentedResponse {
  content?: Record<string, { schema?: DocumentedSchema }>;
}

describe("authentication OpenAPI error contract", () => {
  const document = createOpenApiDocument();

  // Accepts an inline schema or a reference to a registered component.
  function resolve(schema: DocumentedSchema | undefined) {
    const name = schema?.$ref?.replace("#/components/schemas/", "");
    return name
      ? (document.components?.schemas?.[name] as DocumentedSchema | undefined)
      : schema;
  }

  it.each([
    ["/api/v1/auth/login", "post", "400"],
    ["/api/v1/auth/login", "post", "401"],
    ["/api/v1/auth/me", "get", "401"],
    ["/api/v1/auth/logout", "post", "401"],
  ] as const)(
    "documents Problem Details for %s %s %s",
    (path, method, status) => {
      const operation = document.paths?.[path]?.[method];
      const response = operation?.responses?.[status] as
        DocumentedResponse | undefined;
      expect(response).toBeDefined();

      expect(Object.keys(response?.content ?? {})).toEqual([
        "application/problem+json",
      ]);
      const schema = resolve(
        response?.content?.["application/problem+json"]?.schema,
      );
      expect([...(schema?.required ?? [])].sort()).toEqual([
        "detail",
        "instance",
        "requestId",
        "status",
        "title",
        "type",
      ]);
      expect(schema?.properties).toMatchObject({
        type: { type: "string" },
        title: { type: "string" },
        status: { type: "integer" },
        detail: { type: "string" },
        instance: { type: "string" },
        requestId: { type: "string" },
      });
    },
  );
});
