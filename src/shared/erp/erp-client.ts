import type { z } from "zod";

import { ErpError, issuePaths } from "./erp-error.js";
import type { ErpErrorKind } from "./erp-error.js";

// Confirmed P1. Lower case because header names are case-insensitive.
export const ERP_API_KEY_HEADER = "x-api-key";

const MAX_ATTEMPTS = 5;
const BASE_BACKOFF_MS = 2_000;
const MAX_RETRY_AFTER_MS = 60_000;

export interface ErpLogger {
  warn(fields: Record<string, unknown>, message: string): void;
}

export interface ErpClientOptions {
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
  fetch?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => number;
  logger?: ErpLogger;
}

export interface ErpClient {
  erpGet<T extends z.ZodType>(path: string, schema: T): Promise<z.output<T>>;
}

interface RetryableFailure {
  kind: ErpErrorKind;
  status?: number;
  response?: Response;
}

const noopLogger: ErpLogger = { warn: () => undefined };

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function createErpClient(options: ErpClientOptions): ErpClient {
  const fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? Date.now;
  const logger = options.logger ?? noopLogger;

  async function erpGet<T extends z.ZodType>(
    path: string,
    schema: T,
  ): Promise<z.output<T>> {
    if (!path.startsWith("/")) {
      // A programming error, not an ERP failure. The path is left out of the
      // message because it may carry business data.
      throw new TypeError('ERP path must start with "/".');
    }
    const safePath = path.split("?")[0] ?? path;
    let failure: RetryableFailure | undefined;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const outcome = await attemptRead(path, safePath, schema, attempt);
      if (outcome.done) {
        return outcome.data;
      }
      failure = outcome.failure;

      if (attempt < MAX_ATTEMPTS) {
        const waitMs =
          retryAfterMs(failure.response) ??
          BASE_BACKOFF_MS * 2 ** (attempt - 1);
        logger.warn(
          {
            path: safePath,
            kind: failure.kind,
            ...(failure.status === undefined ? {} : { status: failure.status }),
            attempt,
            waitMs,
          },
          "Retrying ERP request",
        );
        await sleep(waitMs);
      }
    }

    throw new ErpError({
      kind: failure?.kind ?? "network",
      path: safePath,
      attempts: MAX_ATTEMPTS,
      ...(failure?.status === undefined ? {} : { status: failure.status }),
      ...(await readSafeErrorDetails(failure?.response)),
    });
  }

  async function attemptRead<T extends z.ZodType>(
    path: string,
    safePath: string,
    schema: T,
    attempt: number,
  ): Promise<
    | { done: true; data: z.output<T> }
    | { done: false; failure: RetryableFailure }
  > {
    let response: Response;
    let body: string;
    try {
      response = await fetchImpl(`${options.baseUrl}${path}`, {
        method: "GET",
        headers: { [ERP_API_KEY_HEADER]: options.apiKey },
        signal: AbortSignal.timeout(options.timeoutMs),
      });
      if (!response.ok) {
        if (isRetryableStatus(response.status)) {
          return {
            done: false,
            failure: { kind: "http", status: response.status, response },
          };
        }
        throw new ErpError({
          kind: "http",
          path: safePath,
          attempts: attempt,
          status: response.status,
          ...(await readSafeErrorDetails(response)),
        });
      }
      body = await response.text();
    } catch (error) {
      if (error instanceof ErpError) {
        throw error;
      }
      return { done: false, failure: { kind: classifyFailure(error) } };
    }

    const parsed = schema.safeParse(parseJson(body));
    if (!parsed.success) {
      throw new ErpError({
        kind: "invalid-response",
        path: safePath,
        attempts: attempt,
        status: response.status,
        issues: issuePaths(parsed.error.issues),
      });
    }
    return { done: true, data: parsed.data };
  }

  function retryAfterMs(response: Response | undefined): number | undefined {
    const value = response?.headers.get("retry-after")?.trim();
    if (!value) {
      return undefined;
    }
    let milliseconds: number;
    if (/^\d+$/.test(value)) {
      milliseconds = Number(value) * 1_000;
    } else {
      const date = Date.parse(value);
      const currentTime = now();
      if (Number.isNaN(date) || date < currentTime) {
        return undefined;
      }
      milliseconds = date - currentTime;
    }
    return Math.min(milliseconds, MAX_RETRY_AFTER_MS);
  }

  return { erpGet };
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function classifyFailure(error: unknown): ErpErrorKind {
  const name = error instanceof Error ? error.name : undefined;
  return name === "TimeoutError" || name === "AbortError"
    ? "timeout"
    : "network";
}

// Returns undefined for non-JSON bodies so schema validation reports the failure.
function parseJson(body: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return undefined;
  }
}

interface SafeErrorDetails {
  requestId?: string;
  title?: string;
  type?: string;
  fields?: string[];
}

// Best effort, whatever the media type. Only these fields are kept; `detail`,
// `instance`, and `erros[].mensagem` may repeat sent values and are dropped.
async function readSafeErrorDetails(
  response: Response | undefined,
): Promise<SafeErrorDetails> {
  if (!response) {
    return {};
  }
  try {
    const body = parseJson(await response.text());
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return {};
    }
    const record = body as Record<string, unknown>;
    const fields = fieldNames(record.erros);
    return {
      ...(typeof record.requestId === "string"
        ? { requestId: record.requestId }
        : {}),
      ...(typeof record.title === "string" ? { title: record.title } : {}),
      ...(typeof record.type === "string" ? { type: record.type } : {}),
      ...(fields.length > 0 ? { fields } : {}),
    };
  } catch {
    // The error body is optional; its absence never changes the error kind.
    return {};
  }
}

// The `campo` strings of the `erros` entries; other entries are ignored.
function fieldNames(erros: unknown): string[] {
  if (!Array.isArray(erros)) {
    return [];
  }
  return erros.flatMap((entry: unknown) =>
    typeof entry === "object" &&
    entry !== null &&
    "campo" in entry &&
    typeof entry.campo === "string"
      ? [entry.campo]
      : [],
  );
}
