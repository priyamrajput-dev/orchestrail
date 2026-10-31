import { describe, expect, it } from "bun:test";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { createApplication } from "../src/app";
import { AppError } from "../src/common/errors/app-error";
import { ERROR_CODES } from "../src/common/errors/error-codes";

describe("API Error Handling & Health Endpoints", () => {
  it("returns standardized 404 for unknown routes with request_id", async () => {
    const app = createApplication();
    const res = await app.request("/unknown-route");

    expect(res.status).toBe(404);
    const body = (await res.json()) as any;
    expect(body.error).toBeDefined();
    expect(body.error.code).toBe(ERROR_CODES.NOT_FOUND);
    expect(body.error.message).toContain("Route not found");
    expect(body.error.request_id).toMatch(/^req_/);
  });

  it("propagates incoming X-Request-Id header", async () => {
    const app = createApplication();
    const customId = "req_custom_trace_999";
    const res = await app.request("/health/live", {
      headers: { "x-request-id": customId },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("x-request-id")).toBe(customId);
  });

  it("handles AppError with expected HTTP status, code, and details", async () => {
    const app = createApplication();
    app.get("/test/app-error", () => {
      throw new AppError({
        code: ERROR_CODES.UNAUTHORIZED,
        message: "Invalid API key secret",
        details: [{ field: "authorization", message: "Key has expired" }],
      });
    });

    const res = await app.request("/test/app-error");
    expect(res.status).toBe(401);

    const body = (await res.json()) as any;
    expect(body.error.code).toBe(ERROR_CODES.UNAUTHORIZED);
    expect(body.error.message).toBe("Invalid API key secret");
    expect(body.error.details).toEqual([
      { field: "authorization", message: "Key has expired" },
    ]);
    expect(body.error.request_id).toBeDefined();
  });

  it("handles AppError with custom status code", async () => {
    const app = createApplication();
    app.get("/test/conflict", () => {
      throw new AppError({
        code: ERROR_CODES.CONFLICT,
        message: "Idempotency key already exists",
      });
    });

    const res = await app.request("/test/conflict");
    expect(res.status).toBe(409);

    const body = (await res.json()) as any;
    expect(body.error.code).toBe(ERROR_CODES.CONFLICT);
    expect(body.error.message).toBe("Idempotency key already exists");
  });

  it("handles Zod validation errors as 400 VALIDATION_ERROR with structured details", async () => {
    const app = createApplication();
    const schema = z.object({
      event_type: z.string({ message: "Required field" }),
      payload: z.record(z.string(), z.unknown()),
    });

    app.post("/test/zod", async (c) => {
      const raw = await c.req.json();
      schema.parse(raw);
      return c.json({ ok: true });
    });

    const res = await app.request("/test/zod", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payload: {} }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe(ERROR_CODES.VALIDATION_ERROR);
    expect(body.error.message).toBe("Request validation failed");
    expect(body.error.details).toBeArray();
    expect(body.error.details[0].field).toBe("event_type");
    expect(body.error.details[0].message).toBe("Required field");
  });

  it("handles Hono HTTPException correctly", async () => {
    const app = createApplication();
    app.get("/test/http-exception", () => {
      throw new HTTPException(403, { message: "Scope forbidden" });
    });

    const res = await app.request("/test/http-exception");
    expect(res.status).toBe(403);

    const body = (await res.json()) as any;
    expect(body.error.code).toBe(ERROR_CODES.FORBIDDEN);
    expect(body.error.message).toBe("Scope forbidden");
  });

  it("handles unexpected errors safely without exposing stack traces or SQL internals", async () => {
    const app = createApplication();
    app.get("/test/unexpected", () => {
      throw new Error(
        "FATAL: pg_hba.conf rejects connection from user postgres password secret_pw",
      );
    });

    const res = await app.request("/test/unexpected");
    expect(res.status).toBe(500);

    const body = (await res.json()) as any;
    expect(body.error.code).toBe(ERROR_CODES.INTERNAL_SERVER_ERROR);
    expect(body.error.message).toBe(
      "An unexpected internal server error occurred",
    );
    // Ensure sensitive info and stack traces are not leaked
    expect(JSON.stringify(body)).not.toContain("FATAL");
    expect(JSON.stringify(body)).not.toContain("secret_pw");
    expect(body.stack).toBeUndefined();
    expect(body.error.stack).toBeUndefined();
  });

  it("successfully responds to health check routes", async () => {
    const app = createApplication();

    const liveRes = await app.request("/health/live");
    expect(liveRes.status).toBe(200);
    const liveBody = (await liveRes.json()) as any;
    expect(liveBody.status).toBe("ok");
    expect(liveBody.uptime).toBeNumber();

    const readyRes = await app.request("/health/ready");
    expect(readyRes.status).toBe(200);
    const readyBody = (await readyRes.json()) as any;
    expect(readyBody.status).toBe("ready");
    expect(readyBody.checks).toEqual({
      database: "pending",
      redis: "pending",
    });
  });
});
