import type { MiddlewareHandler } from "hono";
import { AppError } from "../../common/errors/app-error";
import { ERROR_CODES } from "../../common/errors/error-codes";
import type { ApiScope } from "./scopes";

/**
 * Reusable middleware ensuring the authenticated caller possesses the required scope.
 * Supports exact scope match or wildcard ('*') administrative scope.
 */
export function requireScope(requiredScope: ApiScope): MiddlewareHandler {
  return async (c, next) => {
    const callerScopes = (c.get("scopes") as string[] | undefined) || [];

    if (!callerScopes.includes(requiredScope) && !callerScopes.includes("*")) {
      throw new AppError({
        code: ERROR_CODES.FORBIDDEN,
        message: `Forbidden: API key lacks required scope '${requiredScope}'`,
      });
    }

    await next();
  };
}
