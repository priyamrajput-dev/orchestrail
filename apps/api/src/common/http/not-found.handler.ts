import type { NotFoundHandler } from "hono";
import { ERROR_CODES } from "../errors/error-codes";
import type { StandardErrorResponse } from "../errors/error-handler";

export const notFoundHandler: NotFoundHandler = (c) => {
  const requestId = (c.get("requestId") as string | undefined) || undefined;

  const responsePayload: StandardErrorResponse = {
    error: {
      code: ERROR_CODES.NOT_FOUND,
      message: `Route not found: ${c.req.method} ${c.req.path}`,
      request_id: requestId,
    },
  };

  return c.json(responsePayload, 404);
};
