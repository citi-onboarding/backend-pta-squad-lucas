import pino from "pino";
import type { DestinationStream } from "pino";

import type { Environment } from "../config/env.js";

export function createLogger(
  environment: Pick<Environment, "LOG_LEVEL">,
  destination?: DestinationStream,
) {
  return pino(
    {
      level: environment.LOG_LEVEL,
      redact: {
        paths: [
          "req.headers.authorization",
          "req.headers.cookie",
          'req.headers["x-api-key"]',
          'headers["x-api-key"]',
          "res.headers.set-cookie",
          "password",
          "token",
          "accessToken",
          "refreshToken",
        ],
        censor: "[REDACTED]",
      },
    },
    destination,
  );
}
