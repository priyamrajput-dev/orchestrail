# Orchestrail API — Phase 1 Proposal

**Status:** Proposed API contract. These routes are planned; do not consider them implemented until code and tests exist.

## 1. Conventions

- Base path: `/v1`.
- Transport: HTTPS in deployed environments.
- Request/response format: JSON unless otherwise specified.
- Customer API authentication: `Authorization: Bearer <api_key>`.
- Tenant identity is derived from the authenticated API key, not accepted from request bodies.
- API keys have scopes; each route must declare its required scope.
- Use a request/correlation ID in responses and logs.
- Use cursor pagination for collection endpoints.
- Use UTC timestamps in RFC 3339/ISO 8601 format.
- Validate request bodies, query parameters, and path parameters with shared schemas.

Dashboard/browser authentication is a separate future concern. Do not assume customer API keys are the final dashboard login mechanism.

## 2. Common response and error conventions

Successful responses should be consistent and documented per route. Errors should use a common structure, for example:

```json
{
  "error": {
    "code": "idempotency_conflict",
    "message": "The idempotency key was already used with a different request body.",
    "request_id": "req_example"
  }
}
```

Expected status classes:

- `400` malformed request or invalid parameters.
- `401` missing, invalid, expired, or revoked API key.
- `403` authenticated key lacks the required scope.
- `404` resource absent or not visible within the authenticated tenant.
- `409` idempotency conflict or incompatible state transition.
- `422` semantically invalid request, where distinguished from `400`.
- `429` tenant rate limit exceeded.
- `500` unexpected internal error.
- `503` temporary dependency/service unavailability when the request cannot be safely accepted.

Do not leak whether a resource exists in a different tenant. Cross-tenant resource identifiers should normally behave as not found.

## 3. API key management

| Method   | Path                  | Purpose           | Proposed scope   |
| -------- | --------------------- | ----------------- | ---------------- |
| `POST`   | `/v1/api-keys`        | Create an API key | `api_keys:write` |
| `GET`    | `/v1/api-keys`        | List key metadata | `api_keys:read`  |
| `DELETE` | `/v1/api-keys/:keyId` | Revoke a key      | `api_keys:write` |

### Create key

Example body:

```json
{
  "name": "Production ingestion key",
  "scopes": ["events:write", "events:read", "endpoints:read"],
  "expires_at": null
}
```

The response may include the plaintext secret exactly once, alongside its ID, prefix, scopes, and creation metadata. Persist only a hash of the high-entropy secret. Listing must never return the secret again.

The first tenant and first administrative API key need a controlled bootstrap/provisioning process. Do not create an unauthenticated public endpoint that allows anyone to create a tenant or key.

## 4. Event ingestion and reads

| Method | Path                             | Purpose                      | Proposed scope    |
| ------ | -------------------------------- | ---------------------------- | ----------------- |
| `POST` | `/v1/events`                     | Accept an event              | `events:write`    |
| `GET`  | `/v1/events`                     | List tenant events           | `events:read`     |
| `GET`  | `/v1/events/:eventId`            | Read event details           | `events:read`     |
| `GET`  | `/v1/events/:eventId/deliveries` | List deliveries for an event | `deliveries:read` |

### `POST /v1/events`

Required headers:

```http
Authorization: Bearer <api_key>
Idempotency-Key: <tenant-scoped-unique-value>
Content-Type: application/json
```

Proposed body:

```json
{
  "type": "order.completed",
  "data": {
    "order_id": "ord_123",
    "amount": 2500,
    "currency": "INR"
  },
  "occurred_at": "2026-10-30T12:00:00Z"
}
```

`type` and `data` are required. `occurred_at` is optional; if omitted, the platform records its own receipt/creation timestamp and documents the distinction. The idempotency header is required for the first version unless a later documented decision changes that requirement.

The API must:

1. Authenticate the API key and resolve its tenant/scopes.
2. Validate the body and idempotency header.
3. Compute a stable request hash from the accepted semantic request representation.
4. Insert the event, matching delivery records, and outbox messages in one PostgreSQL transaction.
5. Commit before returning success.
6. Return without waiting for customer webhook delivery.

New event response example (`202 Accepted`):

```json
{
  "event_id": "<event-uuid>",
  "accepted": true,
  "duplicate": false,
  "deliveries_created": 2
}
```

Idempotency behavior:

- Same tenant + same key + same request hash: return the existing event result with `duplicate: true`; do not create additional original deliveries.
- Same tenant + same key + different request hash: return `409 idempotency_conflict`.
- Different tenants may use the same idempotency key independently.

The exact duplicate response status (for example `200` versus `202`) should be finalized and documented consistently during implementation. The semantic response must identify the existing event and must not imply a second event was created.

### Event listing

Proposed query parameters:

- `limit` (bounded server-side maximum)
- `cursor`
- `type`
- `from`
- `to`

Return a page of tenant-owned events and an opaque next cursor. Do not use unbounded page sizes.

## 5. Endpoint management and subscriptions

| Method   | Path                                      | Purpose                                | Proposed scope    |
| -------- | ----------------------------------------- | -------------------------------------- | ----------------- |
| `POST`   | `/v1/endpoints`                           | Register an endpoint                   | `endpoints:write` |
| `GET`    | `/v1/endpoints`                           | List endpoints                         | `endpoints:read`  |
| `GET`    | `/v1/endpoints/:endpointId`               | Read endpoint                          | `endpoints:read`  |
| `PATCH`  | `/v1/endpoints/:endpointId`               | Update endpoint metadata/configuration | `endpoints:write` |
| `DELETE` | `/v1/endpoints/:endpointId`               | Disable endpoint                       | `endpoints:write` |
| `POST`   | `/v1/endpoints/:endpointId/rotate-secret` | Rotate signing secret                  | `endpoints:write` |

### Create endpoint

Proposed body:

```json
{
  "url": "https://customer.example/webhooks/orchestrail",
  "description": "Production order webhook",
  "event_types": ["order.completed", "payment.failed"]
}
```

The service validates the URL and subscription list, creates the endpoint, generates a high-entropy signing secret, encrypts the secret at rest, and persists subscriptions. The plaintext signing secret is returned once. It must not be returned by ordinary endpoint reads.

Outbound URL validation must defend against SSRF, including loopback/private/link-local/metadata destinations, DNS resolution and rebinding, and redirects. The redirect policy must be explicit; do not assume validating the initial URL is sufficient.

### Update and delete

`PATCH` may update URL, description, enabled/disabled status, and subscriptions. Subscription replacement should be transactional. `DELETE` should initially be a soft disable so delivery history and referential integrity are preserved.

### Rotate secret

Generate a new secret and update encrypted secret material and key version. Define whether an overlap period supports both old and new secrets; do not silently assume old signatures remain valid.

## 6. Delivery APIs

| Method | Path                                  | Purpose                  | Proposed scope     |
| ------ | ------------------------------------- | ------------------------ | ------------------ |
| `GET`  | `/v1/deliveries`                      | List tenant deliveries   | `deliveries:read`  |
| `GET`  | `/v1/deliveries/:deliveryId`          | Read delivery            | `deliveries:read`  |
| `GET`  | `/v1/deliveries/:deliveryId/attempts` | Read attempt history     | `deliveries:read`  |
| `POST` | `/v1/deliveries/:deliveryId/replay`   | Create a replay delivery | `deliveries:write` |

Proposed list filters:

- `status`
- `endpoint_id`
- `event_id`
- `from`
- `to`
- `limit`
- `cursor`

Replay behavior:

- Verify the original delivery belongs to the authenticated tenant.
- Verify the endpoint/event can still be replayed under product policy.
- Create a new delivery record linked to the original through `replay_of_delivery_id`.
- Create an outbox message for the new delivery in the same transaction.
- Preserve the original delivery and attempt history.
- Make replay requests idempotent or otherwise protect against accidental repeated clicks; decide and document the replay idempotency contract before implementation.

## 7. Webhook envelope and signing proposal

A delivery should include a stable delivery ID, event ID, event type, timestamp, and event data. The exact JSON envelope and header names are a contract that must be finalized before SDK implementation.

The signature should be HMAC-SHA256 over a documented timestamp-and-raw-body construction. Verification must use the exact raw request bytes, validate timestamp tolerance, and compare signatures in constant time. Do not parse and re-serialize JSON before verification.

The SDK's `verifyWebhook` should expose a clear contract for raw body, signature headers, secret, and timestamp tolerance. It should fail closed on missing or malformed signature material.

## 8. Not part of Phase 1

Do not add workflow, usage/billing, AI chat, RAG, or GraphRAG endpoints to the Phase 1 API. Those routes will be designed when their respective phases begin and their data models are known.
