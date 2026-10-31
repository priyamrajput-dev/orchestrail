import { Hono } from "hono";
import { logger } from "hono/logger";
import type { DatabaseClient } from "@orchestrail/db";
import { globalErrorHandler } from "./common/errors/error-handler";
import { notFoundHandler } from "./common/http/not-found.handler";
import { createApiKeysRouter } from "./features/api-keys/api-keys.routes";
import { apiKeyAuthMiddleware } from "./features/authentication/api-key-auth.middleware";
import { createEventsRouter } from "./features/events/events.routes";
import { healthRouter } from "./features/health/health.routes";

export type AppVariables = {
  requestId: string;
  tenantId?: string;
  apiKeyId?: string;
  scopes?: string[];
};

export interface AppDependencies {
  dbClient?: DatabaseClient;
}

export function createApplication(deps: AppDependencies = {}) {
  const app = new Hono<{ Variables: AppVariables }>();

  // 1. Request correlation ID middleware
  app.use("*", async (c, next) => {
    const incomingId = c.req.header("x-request-id");
    const requestId =
      incomingId && incomingId.trim().length > 0
        ? incomingId
        : `req_${crypto.randomUUID().replace(/-/g, "")}`;

    c.set("requestId", requestId);
    c.header("X-Request-Id", requestId);

    await next();
  });

  // 2. Request logger
  app.use(logger());

  // 3. Root endpoint
  app.get("/", (c) => {
    return c.json({ message: "Welcome to Orchestrail API" });
  });

  // 4. Public Health routes
  app.route("/health", healthRouter);

  // 5. Versioned /v1 routes
  if (deps.dbClient) {
    const v1 = new Hono<{ Variables: AppVariables }>();

    // Protected /v1/api-keys routes using apiKeyAuthMiddleware
    const apiKeysRouter = createApiKeysRouter(deps.dbClient);
    v1.use("/api-keys/*", apiKeyAuthMiddleware(deps.dbClient));
    v1.use("/api-keys", apiKeyAuthMiddleware(deps.dbClient));
    v1.route("/api-keys", apiKeysRouter);

    // Protected /v1/events routes using apiKeyAuthMiddleware
    const eventsRouter = createEventsRouter(deps.dbClient);
    v1.use("/events/*", apiKeyAuthMiddleware(deps.dbClient));
    v1.use("/events", apiKeyAuthMiddleware(deps.dbClient));
    v1.route("/events", eventsRouter);

    app.route("/v1", v1);
  }

  // 6. Global 404 handler
  app.notFound(notFoundHandler);

  // 7. Global error handler
  app.onError(globalErrorHandler);

  return app;
}
