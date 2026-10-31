# Orchestrail Project Status

Last updated: 2026-10-31

This file tracks verified implementation progress. Proposed architecture is not the same as completed implementation.

## Current position

- **Phase:** 1 — Events + Webhook Delivery + SDK
- **Milestone:** 1 — Inspect and establish the monorepo
- **Current immediate task:** Inspect the generated Turborepo scaffold before modifying it.

## Verified environment (reported by developer)

| Tool           | Reported version | Notes                                                             |
| -------------- | ---------------: | ----------------------------------------------------------------- |
| Bun            |            1.4.4 | Available in terminal.                                            |
| Docker         |           29.4.0 | Available in terminal.                                            |
| Docker Compose |            5.1.1 | Available in terminal.                                            |
| Git            |           2.50.1 | Available in terminal.                                            |
| Turborepo      |      Initialized | Scaffold success message received; exact files not yet inspected. |

## Verified setup

- [x] Project directory created as `Orchestrail`.
- [x] Turborepo scaffold generated.
- [x] Git repository initialized by scaffold.
- [x] Bun, Docker, Docker Compose, and Git versions checked.

## Not yet verified

- [ ] Root `package.json` inspected.
- [ ] `turbo.json` inspected.
- [ ] Bun lockfile identified.
- [ ] Workspace globs configured.
- [ ] `apps/*` and `packages/*` structure established.
- [ ] TypeScript configuration established.
- [ ] Docker Compose PostgreSQL service created and tested.
- [ ] Docker Compose Redis service created and tested.
- [ ] Drizzle configured.
- [ ] Initial migrations created and applied.

## Settled architecture decisions

- Bun workspaces + Turborepo monorepo.
- Bun + Hono for the TypeScript API.
- Bun worker with BullMQ.
- Redis as BullMQ backend from Phase 1.
- PostgreSQL as business source of truth.
- Drizzle ORM and migrations.
- Transactional outbox from PostgreSQL to BullMQ.
- TypeScript SDK using the REST API.
- Next.js dashboard.
- Separate Python/FastAPI AI service in a later phase.
- Build Orchestrail's business logic; use BullMQ for queue mechanics.

## Open decisions to resolve before or during implementation

- Inspect the exact Turborepo scaffold and preserve compatible generated configuration.
- Decide the initial BullMQ Redis client adapter and verify Bun compatibility for selected versions.
- Finalize environment variable names and secret-management approach.
- Finalize the webhook envelope, signature header names, timestamp format, and secret-rotation overlap policy.
- Finalize API-key bootstrap and scope model.
- Finalize duplicate event response status.
- Finalize replay idempotency and sequence allocation strategy.
- Define payload, response excerpt, and event retention limits.

## Update discipline

When a milestone is completed, update its checklist and record evidence (test command, migration, benchmark, or observed behavior). Do not mark work complete based only on a plan or generated file existing. Record important decisions and their trade-offs in `docs/ARCHITECTURE.md` or a separate decision record.
