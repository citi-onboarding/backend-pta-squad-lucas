import { Router } from "express";
import type { Router as ExpressRouter } from "express";
import type { ZodType, z } from "zod";

import { HttpProblem } from "../../shared/http/problem.js";
import { validate } from "../../shared/http/validate.js";
import {
  acceptInvitationRequestSchema,
  invitationLookupSchema,
  invitationTokenRequestSchema,
} from "./user-administration.schemas.js";
import type { UserAdministrationService } from "./user-administration.service.js";
import "./user-administration.openapi.js";

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

// Public routes: the invitation token in the body is the only credential.
export function createInvitationRouter(
  service: UserAdministrationService,
): ExpressRouter {
  const router = Router();
  router.use((_request, response, next) => {
    response.set("Cache-Control", "no-store");
    next();
  });

  router.post(
    "/lookup",
    validate({ body: invitationTokenRequestSchema }),
    async (request, response) => {
      const { token } = request.body as z.infer<
        typeof invitationTokenRequestSchema
      >;
      response.json(
        serialize(
          invitationLookupSchema,
          await service.lookupInvitation(token),
        ),
      );
    },
  );

  router.post(
    "/accept",
    validate({ body: acceptInvitationRequestSchema }),
    async (request, response) => {
      const { token, password } = request.body as z.infer<
        typeof acceptInvitationRequestSchema
      >;
      await service.acceptInvitation(token, password);
      response.status(204).end();
    },
  );

  return router;
}
