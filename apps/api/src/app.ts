import { Hono } from "hono";
import { logger } from "hono/logger";

export function createApplication() {
  const app = new Hono();

  // Middleware
  app.use(logger());

  // Routes
  app.get("/", (c) => {
    return c.json({ message: "Welcome to Orchestrail API" });
  });

  return app;
}
