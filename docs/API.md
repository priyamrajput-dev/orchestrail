# Orchestrail API — Phase 1 Contract

**Status:** Phase 1 API specifications. Verified implemented endpoints include `/v1/api-keys` and `/v1/events`.

## 1. Conventions

- Base path: `/v1`.
- Transport: HTTPS in deployed environments.
- Request/response format: JSON unless otherwise specified.
- Customer API authentication: `Authorization: Bearer <api_key>`.
- Tenant identity is derived from the authenticated API key, not accepted from request bodies.
- API keys have scopes; each route declares and enforces its required scope via `requireScope`.
- Use a request/correlation ID (`X-Request-Id`) in responses and logs.
- Use cursor pagination for collection endpoints.
- Use UTC timestamps in RFC 3339/ISO 8601 format.
- Validate request bodies, query parameters, and path parameters with shared Zod schemas.

Dashboard/browser authentication is a separate future concern. Customer API keys are for machine-to-machine integrations.

## 2. Common response and error conventions

Successful responses are structured and documented per route. Errors use a standard format:

```json
{
  "error": {
    "code": "IDEMPOTENCY_CONFLICT",
    "message": "An event with the same idempotency key exists with a different payload",
    "request_id": "req_example"
  }
}
```

Standard error codes:

- `VALIDATION_ERROR` (400): malformed request, invalid fields, or missing parameters.
- `IDEMPOTENCY_KEY_REQUIRED` (400): missing or empty `Idempotency-Key` header.
- `UNAUTHORIZED` (401): missing, invalid, expired, or revoked API key.
- `FORBIDDEN` (403): authenticated key lacks the required scope or tenant is suspended.
- `NOT_FOUND` (404): resource absent or not visible within the authenticated tenant.
- `CONFLICT` / `IDEMPOTENCY_CONFLICT` (409): idempotency conflict or duplicate key with different payload.
- `PAYLOAD_TOO_LARGE` (413): request body exceeds the configured size limit (default 256 KiB).
- `RATE_LIMIT_EXCEEDED` (429): tenant rate limit exceeded.
- `INTERNAL_SERVER_ERROR` (500): unexpected internal server error.
- `SERVICE_UNAVAILABLE` (503): temporary dependency unavailability.

Cross-tenant resources always behave as not found (`404`) to prevent information leakage.

## 3. API key management

Implemented in `apps/api/src/features/api-keys/api-keys.routes.ts`.
All endpoints require `Authorization: Bearer <api_key>` with `api_keys:read` or `api_keys:write`.

| Method   | Path                  | Purpose           | Scope            |
| -------- | --------------------- | ----------------- | ---------------- |
| `POST`   | `/v1/api-keys`        | Create an API key | `api_keys:write` |
| `GET`    | `/v1/api-keys`        | List key metadata | `api_keys:read`  |
| `DELETE` | `/v1/api-keys/:keyId` | Revoke a key      | `api_keys:write` |

### Create key

Creates a key with scoped permissions. Callers cannot grant scopes they do not hold.
The plaintext key is returned exactly once in the response.

## 4. Event ingestion (`POST /v1/events`)

Implemented in `apps/api/src/features/events/events.routes.ts`.

### Endpoint Contract

```http
POST /v1/events
Authorization: Bearer <api_key>
Idempotency-Key: <tenant-scoped-unique-value>
Content-Type: application/json
```

Required scope: `events:write`.

### Request Body Schema

```json
{
  "type": "order.completed",
  "data": {
    "order_id": "ord_123",
    "amount": 2500,
    "currency": "INR"
  },
  "occurred_at": "2026-10-31T10:30:00Z"
}
```

Validation rules:

- `Idempotency-Key` header is required, non-empty, max 255 characters.
- `type` is required, max 255 characters, must follow lowercase format using alphanumeric characters separated by dots, underscores, or hyphens (`/^[a-z0-9]+([._-][a-z0-9]+)*$/`).
- `data` must be a valid non-null, non-array JSON object.
- `occurred_at` is optional, must be a valid ISO-8601 timestamp string when supplied.
- Initial request body size limit: 256 KiB (`MAX_EVENT_BODY_BYTES`, default 262,144 bytes). Enforced prior to JSON parsing.

### Deterministic Request Hashing

Request hash is computed via SHA-256 over canonical JSON serialization of the validated semantic input (`type`, `data`, and optional explicit `occurred_at`). Object keys are recursively sorted alphabetically so key reordering does not alter the hash.

### Idempotency Behavior

1. **New event (`HTTP 202 Accepted`):**
   ```json
   {
     "event_id": "e838f328-98e6-4fd2-892f-b4ec2b55f653",
     "accepted": true,
     "duplicate": false,
     "deliveries_created": 2
   }
   ```
2. **Identical duplicate retry (`HTTP 200 OK`):**
   Same idempotency key with identical semantic request hash returns the original event and counts existing deliveries without creating duplicate records:
   ```json
   {
     "event_id": "e838f328-98e6-4fd2-892f-b4ec2b55f653",
     "accepted": true,
     "duplicate": true,
     "deliveries_created": 2
   }
   ```
3. **Idempotency conflict (`HTTP 409 Conflict`):**
   Same idempotency key with a differing payload returns error code `IDEMPOTENCY_CONFLICT`.

### Transactional Boundary

The entire ingestion sequence occurs within a single PostgreSQL transaction:

1. Event insertion with `ON CONFLICT (tenant_id, idempotency_key) DO NOTHING`.
2. Matching active endpoints and their active signing secrets for the event type.
3. Inserting snapshot `deliveries` (URL, signing secret ID, secret version, sequence 1).
4. Inserting transactional `outbox_messages` (`webhook.delivery.requested`).
5. Transaction commit before HTTP response. No Redis or external HTTP calls take place inside the transaction.

## 5. Planned Endpoints (Upcoming Milestones)

- Endpoint management: `POST /v1/endpoints`, `GET /v1/endpoints`, `PATCH /v1/endpoints/:id`, `DELETE /v1/endpoints/:id`.
- Delivery tracking: `GET /v1/deliveries`, `GET /v1/deliveries/:id`, `GET /v1/deliveries/:id/attempts`.
