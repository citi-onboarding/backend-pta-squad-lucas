import { writeFile } from "node:fs/promises";

import "../src/modules/authentication/authentication.openapi.js";

// <example-item-openapi>
import "../src/modules/example-items/example-item.openapi.js";
// </example-item-openapi>
import "../src/modules/erp-sync/erp-sync.openapi.js";
import { createOpenApiDocument } from "../src/shared/http/openapi.js";

await writeFile(
  "openapi.json",
  `${JSON.stringify(createOpenApiDocument(), null, 2)}\n`,
  "utf8",
);
