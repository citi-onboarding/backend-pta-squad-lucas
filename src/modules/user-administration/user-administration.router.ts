import { Router } from "express";
import type { RequestHandler, Router as ExpressRouter } from "express";
import type { ZodType, z } from "zod";

import { HttpProblem } from "../../shared/http/problem.js";
import { validate } from "../../shared/http/validate.js";
import {
  availableErpSellerNamesSchema,
  issuedInvitationSchema,
  registerUserRequestSchema,
  registeredUserSchema,
  userIdParamsSchema,
  userListSchema,
} from "./user-administration.schemas.js";
import type { UserAdministrationService } from "./user-administration.service.js";
import "./user-administration.openapi.js";

export interface UserAdministrationRouterOptions {
  service: UserAdministrationService;
  adminGuard: RequestHandler;
}

// A response that breaks its own contract is a server bug: answer 500 and leak
// nothing.
function serialize<T>(schema: ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new HttpProblem(
      500,
      "Internal Server Error",
      "An unexpected error occurred.",
    );
  }
  return parsed.data;
}

export function createUserAdministrationRouter(
  options: UserAdministrationRouterOptions,
): ExpressRouter {
  const { service, adminGuard } = options;
  const router = Router();
  router.use(adminGuard);

  router.get("/", async (_request, response) => {
    response.json(serialize(userListSchema, await service.listUsers()));
  });

  router.post(
    "/",
    validate({ body: registerUserRequestSchema }),
    async (request, response) => {
      const result = await service.registerUser(
        request.body as z.infer<typeof registerUserRequestSchema>,
      );
      response
        .status(201)
        .set("Cache-Control", "no-store")
        .json(serialize(registeredUserSchema, result));
    },
  );

  // Registered before the /:userId routes so that it is never read as an id.
  router.get("/erp-seller-names", async (_request, response) => {
    response.json(
      serialize(
        availableErpSellerNamesSchema,
        await service.listAvailableErpSellerNames(),
      ),
    );
  });

  router.post(
    "/:userId/invitations",
    validate({ params: userIdParamsSchema }),
    async (request, response) => {
      const result = await service.issueInvitation(
        String(request.params.userId),
      );
      response
        .status(201)
        .set("Cache-Control", "no-store")
        .json(serialize(issuedInvitationSchema, result));
    },
  );

  return router;
}
