import { Hono } from "hono";

export const healthRouter = new Hono();

// Liveness check: confirms the process is alive
healthRouter.get("/live", (c) => {
  return c.json({
    status: "ok",
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

// Readiness check: confirms the API can serve traffic
// Backing services (PostgreSQL, Redis) will be checked here in later milestones
healthRouter.get("/ready", (c) => {
  return c.json({
    status: "ready",
    checks: {
      database: "pending",
      redis: "pending",
    },
    timestamp: new Date().toISOString(),
  });
});
