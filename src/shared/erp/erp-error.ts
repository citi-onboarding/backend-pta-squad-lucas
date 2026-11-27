import type { z } from "zod";

export type ErpErrorKind = "http" | "network" | "timeout" | "invalid-response";

export interface ErpErrorDetails {
  kind: ErpErrorKind;
  path: string;
  attempts: number;
  status?: number;
  requestId?: string;
  title?: string;
  type?: string;
  fields?: string[];
  issues?: string[];
}

// Carries only safe, structured facts: no headers, body, cause, or received values.
export class ErpError extends Error {
  readonly kind: ErpErrorKind;
  readonly path: string;
  readonly attempts: number;
  readonly status: number | undefined;
  readonly requestId: string | undefined;
  readonly title: string | undefined;
  readonly type: string | undefined;
  readonly fields: string[] | undefined;
  readonly issues: string[] | undefined;

  constructor(details: ErpErrorDetails) {
    super(buildMessage(details));
    this.name = "ErpError";
    this.kind = details.kind;
    this.path = details.path;
    this.attempts = details.attempts;
    this.status = details.status;
    this.requestId = details.requestId;
    this.title = details.title;
    this.type = details.type;
    this.fields = details.fields;
    this.issues = details.issues;
  }

  toJSON(): ErpErrorDetails & { name: string; message: string } {
    return {
      name: this.name,
      message: this.message,
      kind: this.kind,
      path: this.path,
      attempts: this.attempts,
      ...(this.status === undefined ? {} : { status: this.status }),
      ...(this.requestId === undefined ? {} : { requestId: this.requestId }),
      ...(this.title === undefined ? {} : { title: this.title }),
      ...(this.type === undefined ? {} : { type: this.type }),
      ...(this.fields === undefined ? {} : { fields: this.fields }),
      ...(this.issues === undefined ? {} : { issues: this.issues }),
    };
  }
}

// Keeps only each issue's path, because Zod messages can quote received values.
export function issuePaths(issues: readonly z.core.$ZodIssue[]): string[] {
  return issues.map((issue) => issue.path.map(String).join("."));
}

function buildMessage(details: ErpErrorDetails): string {
  const attempts = `${String(details.attempts)} ${details.attempts === 1 ? "attempt" : "attempts"}`;
  const prefix = `ERP GET ${details.path}`;

  switch (details.kind) {
    case "http":
      return `${prefix} failed with status ${String(details.status)} after ${attempts}`;
    case "network":
      return `${prefix} failed without a response after ${attempts}`;
    case "timeout":
      return `${prefix} timed out after ${attempts}`;
    case "invalid-response":
      return `${prefix} returned an unexpected response body after ${attempts}`;
  }
}
