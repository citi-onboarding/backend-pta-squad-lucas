import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";

export class HttpProblem extends Error {
  constructor(
    public readonly status: number,
    public readonly title: string,
    detail: string,
    public readonly type = "about:blank",
    public readonly extensions: Record<string, unknown> = {},
  ) {
    super(detail);
    this.name = "HttpProblem";
  }
}

export const notFoundHandler: RequestHandler = (request, _response, next) => {
  next(
    new HttpProblem(
      404,
      "Not Found",
      `Route ${request.method} ${request.path} was not found.`,
    ),
  );
};

function isUnparseableBody(error: unknown): boolean {
  return (
    error instanceof Error &&
    "type" in error &&
    error.type === "entity.parse.failed"
  );
}

export const problemHandler: ErrorRequestHandler = (
  error: unknown,
  request,
  response,
  _next,
) => {
  if (error instanceof ZodError) {
    response
      .status(400)
      .type("application/problem+json")
      .json({
        type: "https://node-boilerplate.dev/problems/validation-error",
        title: "Validation Error",
        status: 400,
        detail: "The request did not satisfy the expected contract.",
        instance: request.originalUrl,
        requestId: request.id,
        errors: error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
    return;
  }

  // The parser error carries the raw body, so it is replaced and never logged.
  const knownError = isUnparseableBody(error)
    ? new HttpProblem(400, "Bad Request", "The request body is not valid JSON.")
    : error;

  const problem =
    knownError instanceof HttpProblem
      ? knownError
      : new HttpProblem(
          500,
          "Internal Server Error",
          "An unexpected error occurred.",
        );

  if (!(knownError instanceof HttpProblem)) {
    request.log.error({ err: error }, "Unhandled request error");
  }

  response
    .status(problem.status)
    .type("application/problem+json")
    .json({
      type: problem.type,
      title: problem.title,
      status: problem.status,
      detail: problem.message,
      instance: request.originalUrl,
      requestId: request.id,
      ...problem.extensions,
    });
};
