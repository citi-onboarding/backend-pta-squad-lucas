import { readFile } from "node:fs/promises";

import "../src/modules/authentication/authentication.openapi.js";

// <example-item-openapi>
import "../src/modules/example-items/example-item.openapi.js";
// </example-item-openapi>
import "../src/modules/erp-sync/erp-sync.openapi.js";
import "../src/modules/user-administration/user-administration.openapi.js";
import { createOpenApiDocument } from "../src/shared/http/openapi.js";

const expected = `${JSON.stringify(createOpenApiDocument(), null, 2)}\n`;
const current = await readFile("openapi.json", "utf8");

if (current !== expected) {
  throw new Error(
    "openapi.json is stale. Run pnpm openapi:generate and commit the result.",
  );
}
