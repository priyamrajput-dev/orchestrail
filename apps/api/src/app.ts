import { Hono } from "hono";
import { logger } from "hono/logger";
import { globalErrorHandler } from "./common/errors/error-handler";
import { notFoundHandler } from "./common/http/not-found.handler";
import { healthRouter } from "./features/health/health.routes";

export type AppVariables = {
  requestId: string;
};

export function createApplication() {
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

  // 4. Feature routes
  app.route("/health", healthRouter);

  // 5. Global 404 handler
  app.notFound(notFoundHandler);

  // 6. Global error handler
  app.onError(globalErrorHandler);

  return app;
}
