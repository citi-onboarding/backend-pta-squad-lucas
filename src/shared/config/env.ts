import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  SERVER_HOST: z.string().min(1).default("0.0.0.0"),
  SERVER_PORT: z.coerce.number().int().positive().max(65_535).default(3001),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  CORS_ORIGINS: z.string().default("http://localhost:5173"),
  DATABASE_URL: z.url().startsWith("postgresql://"),
  ERP_API_URL: z
    .url({ protocol: /^https$/ })
    .refine((url) => !url.endsWith("/"), {
      message: "ERP_API_URL must not end with a slash.",
    }),
  ERP_API_KEY: z.string().min(1),
  ERP_REQUEST_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .max(120_000)
    .default(60_000),
  // Only the exact strings are accepted: z.coerce.boolean() would read "false" as true.
  ERP_SYNC_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  // Stopgap admin credential until login exists (F01). Optional: without it every
  // administrator-only endpoint refuses all requests.
  ADMIN_API_TOKEN: z.string().min(32).optional(),
});

export type Environment = z.infer<typeof envSchema> & { corsOrigins: string[] };

export function parseEnvironment(input: NodeJS.ProcessEnv): Environment {
  const parsed = envSchema.parse(input);
  const corsOrigins = parsed.CORS_ORIGINS.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (corsOrigins.length === 0) {
    throw new Error("CORS_ORIGINS must contain at least one origin.");
  }

  // The token key is always present (possibly undefined) so callers can read it.
  return { ...parsed, ADMIN_API_TOKEN: parsed.ADMIN_API_TOKEN, corsOrigins };
}

export const env = parseEnvironment(process.env);
