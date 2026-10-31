# Orchestrail Project Status

Last updated: 2026-10-31

This file tracks verified implementation progress. Proposed architecture is not the same as completed implementation.

## Current position

- **Phase:** 1 — Events + Webhook Delivery + SDK
- **Completed Milestones:**
  - Milestone 1: Monorepo Foundation & API Bootstrap
  - Milestone 2: Docker Infrastructure (PostgreSQL 18.6 & Redis 8.10.3)
  - Milestone 3: Database Foundation (`packages/db` with Bun.SQL + Drizzle ORM)
  - Milestone 4: Tenant Management & API Key Authentication
  - Milestone 6: Event Ingestion, Idempotency and Transactional Outbox
- **Next immediate task:** Milestone 7: Outbox Publisher and BullMQ Queue Workers.

## Verified environment

| Tool           | Reported version | Notes                                                     |
| -------------- | ---------------: | --------------------------------------------------------- |
| Bun            |            1.4.4 | Available in terminal.                                    |
| Docker         |           29.4.0 | Available in terminal.                                    |
| Docker Compose |            5.1.1 | Available in terminal.                                    |
| Git            |           2.50.1 | Available in terminal.                                    |
| PostgreSQL     |             18.6 | Running in container `orchestrail_postgres` on port 5432. |
| Redis          |           8.10.3 | Running in container `orchestrail_redis` on port 6379.    |

## Verified setup & implementations

- [x] Turborepo monorepo scaffold established.
- [x] Docker Compose PostgreSQL 18.6 and Redis 8.10.3 services verified and healthy.
- [x] `@orchestrail/db` package using native `Bun.SQL` pool adapter and Drizzle ORM.
- [x] Database migrations generated with Drizzle Kit and applied.
- [x] Standardized error handling (`AppError`, `globalErrorHandler`, `notFoundHandler`).
- [x] Controlled tenant provisioning CLI (`bun run provision:tenant`).
- [x] API key authentication middleware (`apiKeyAuthMiddleware`) with fast prefix-indexed SHA-256 lookup.
- [x] Scope enforcement middleware (`requireScope`) supporting standard scopes and wildcard `*`.
- [x] API key CRUD endpoints (`/v1/api-keys`).
- [x] Event schemas (`events`, `endpoints`, `signing_secrets`, `endpoint_subscriptions`, `deliveries`, `outbox_messages`).
- [x] Deterministic canonical request hashing (SHA-256 over alphabetically sorted keys).
- [x] `POST /v1/events` ingestion endpoint with 256 KiB body limit.
- [x] PostgreSQL `ON CONFLICT (tenant_id, idempotency_key)` concurrency-safe idempotency.
- [x] Transactional subscription matching and snapshot delivery creation.
- [x] Transactional outbox message persistence (`webhook.delivery.requested`).
- [x] 48 automated integration tests passing across all packages.

## Settled architecture decisions

- Bun workspaces + Turborepo monorepo.
- Bun + Hono for the TypeScript API.
- Bun worker with BullMQ.
- Redis as BullMQ backend from Phase 1.
- PostgreSQL as business source of truth.
- Drizzle ORM with native Bun.SQL pool driver.
- Transactional outbox from PostgreSQL to BullMQ.
- Feature-first vertical slice architecture.
- SHA-256 deterministic canonical serialization for request hashing.
- Idempotency key uniqueness per tenant backed by PostgreSQL constraint.
- Fast index lookup on `api_keys.key_prefix` + constant-time secret comparison.
