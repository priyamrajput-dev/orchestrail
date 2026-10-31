import type { ContentfulStatusCode } from "hono/utils/http-status";
import { type ErrorCode, ERROR_STATUS_MAP } from "./error-codes";

export interface ErrorDetail {
  field?: string;
  message: string;
  [key: string]: unknown;
}

export interface AppErrorOptions {
  code: ErrorCode;
  message: string;
  statusCode?: ContentfulStatusCode;
  details?: ErrorDetail[];
  cause?: unknown;
}

export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: ContentfulStatusCode;
  public readonly details?: ErrorDetail[];
  public override readonly cause?: unknown;

  constructor(options: AppErrorOptions) {
    super(options.message);
    this.name = "AppError";
    this.code = options.code;
    this.statusCode =
      options.statusCode ?? ERROR_STATUS_MAP[options.code] ?? 500;
    this.details = options.details;
    this.cause = options.cause;

    // Restore prototype chain for instanceof checks
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
