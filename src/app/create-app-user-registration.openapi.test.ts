import { describe, expect, it } from "vitest";

import { createOpenApiDocument } from "../shared/http/openapi.js";
import "./create-app.js";

interface SchemaNode {
  $ref?: string;
  allOf?: SchemaNode[];
  properties?: Record<string, SchemaNode>;
  enum?: unknown[];
}

describe("user registration API description", () => {
  const document = createOpenApiDocument();
  const components = (document.components?.schemas ?? {}) as Record<
    string,
    SchemaNode
  >;

  // The member may be declared inline, in a component or through composition.
  function propertiesOf(schema: SchemaNode): Record<string, SchemaNode> {
    if (schema.$ref) {
      return propertiesOf(
        components[schema.$ref.split("/").at(-1) ?? ""] ?? {},
      );
    }
    const composed = (schema.allOf ?? []).map(propertiesOf);
    return Object.assign({}, ...composed, schema.properties) as Record<
      string,
      SchemaNode
    >;
  }

  it("declares conflictField in the 409 response of user registration", () => {
    const response = document.paths?.["/api/v1/users"]?.post?.responses?.[
      "409"
    ] as { content?: Record<string, { schema?: SchemaNode }> } | undefined;
    const schema = response?.content?.["application/problem+json"]?.schema;

    expect(schema).toBeDefined();
    expect(propertiesOf(schema ?? {}).conflictField?.enum).toEqual([
      "email",
      "erpSellerName",
    ]);
  });
});
