import type { Context, ErrorHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { ZodError } from "zod";
import { AppError, type ErrorDetail } from "./app-error";
import { ERROR_CODES, type ErrorCode } from "./error-codes";

export interface StandardErrorResponse {
  error: {
    code: ErrorCode | string;
    message: string;
    details?: ErrorDetail[];
    request_id?: string;
  };
}

const HTTP_STATUS_TO_CODE: Record<number, ErrorCode> = {
  400: ERROR_CODES.VALIDATION_ERROR,
  401: ERROR_CODES.UNAUTHORIZED,
  403: ERROR_CODES.FORBIDDEN,
  404: ERROR_CODES.NOT_FOUND,
  409: ERROR_CODES.CONFLICT,
  429: ERROR_CODES.RATE_LIMIT_EXCEEDED,
  500: ERROR_CODES.INTERNAL_SERVER_ERROR,
  503: ERROR_CODES.SERVICE_UNAVAILABLE,
};

export const globalErrorHandler: ErrorHandler = (err: Error, c: Context) => {
  const requestId = (c.get("requestId") as string | undefined) || undefined;

  // 1. Domain/Application Error
  if (err instanceof AppError) {
    const responsePayload: StandardErrorResponse = {
      error: {
        code: err.code,
        message: err.message,
        details: err.details,
        request_id: requestId,
      },
    };

    if (err.statusCode >= 500) {
      console.error(
        `[${requestId ?? "no-request-id"}] Internal AppError (${err.code}):`,
        err.message,
        err.cause ?? "",
      );
    }

    return c.json(responsePayload, err.statusCode);
  }

  // 2. Zod Validation Error
  if (err instanceof ZodError) {
    const details: ErrorDetail[] = err.issues.map((issue) => ({
      field: issue.path.join("."),
      message: issue.message,
    }));

    const responsePayload: StandardErrorResponse = {
      error: {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: "Request validation failed",
        details,
        request_id: requestId,
      },
    };

    return c.json(responsePayload, 400);
  }

  // 3. Hono HTTPException
  if (err instanceof HTTPException) {
    const status = err.status as ContentfulStatusCode;
    const mappedCode =
      HTTP_STATUS_TO_CODE[status] || ERROR_CODES.INTERNAL_SERVER_ERROR;

    const responsePayload: StandardErrorResponse = {
      error: {
        code: mappedCode,
        message: err.message || "HTTP exception occurred",
        request_id: requestId,
      },
    };

    return c.json(responsePayload, status);
  }

  // 4. Unexpected / Unhandled Exception (Safe fallback, no stack trace or secrets leaked)
  console.error(
    `[${requestId ?? "no-request-id"}] Unexpected internal server error:`,
    err.message,
  );

  const responsePayload: StandardErrorResponse = {
    error: {
      code: ERROR_CODES.INTERNAL_SERVER_ERROR,
      message: "An unexpected internal server error occurred",
      request_id: requestId,
    },
  };

  return c.json(responsePayload, 500);
};
