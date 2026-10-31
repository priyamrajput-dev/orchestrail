# Orchestrail Roadmap

**Current phase:** Phase 1 — Project foundation and event/webhook infrastructure.

The original target was roughly four weeks for Phase 1. Treat that as a planning target, not a deadline that overrides correctness, testing, or learning. Each milestone is complete only when its exit criteria are verified.

## Phase 1 — Events + Webhook Delivery + SDK

### Milestone 1: Inspect and establish the monorepo

Tasks:

- Inspect the generated Turborepo files and lockfile.
- Confirm Bun workspaces and workspace globs.
- Establish `apps/*` and `packages/*` without destroying the scaffold.
- Configure root scripts and TypeScript conventions.
- Create/confirm `apps/api`, `apps/worker`, `apps/web`, `apps/ai` and the shared packages when appropriate.

Exit criteria:

- Workspace packages are discoverable by Bun.
- Turborepo tasks can target the intended workspaces.
- Root install and basic scripts work.
- Existing generated configuration is understood and preserved where useful.

### Milestone 2: Local infrastructure

Tasks:

- Add Docker Compose services for PostgreSQL and Redis.
- Configure local environment variables and `.env.example`.
- Add health checks and persistent local data volumes.
- Start services and verify PostgreSQL and Redis connectivity.
- Document local reset/cleanup behavior.

Exit criteria:

- Both services start reliably.
- Health checks pass.
- Application configuration can connect to each service.
- Secrets are not committed to Git.

### Milestone 3: Database foundation

Tasks:

- Configure `packages/db` and the PostgreSQL driver.
- Configure Drizzle and drizzle-kit.
- Define initial tenant, key, event, endpoint, subscription, delivery, attempt, outbox, and rate-limit schemas.
- Add initial migrations and a development bootstrap/seed approach.
- Add tenant-aware foreign keys, uniqueness constraints, and initial indexes.

Exit criteria:

- Migrations apply to an empty database.
- Schema can be recreated from migrations.
- Constraints reject invalid cross-tenant references and duplicate idempotency keys.
- No production schema changes depend on an automatic push/sync command.

### Milestone 4: Tenant authentication and API keys

Tasks:

- Define tenant provisioning for local development.
- Generate high-entropy API keys.
- Store key hashes and non-secret prefixes only.
- Implement authentication and scope authorization middleware.
- Implement key list and revoke behavior.
- Add expiry and revoked-key behavior.

Exit criteria:

- Valid keys resolve the correct tenant.
- Invalid, expired, and revoked keys fail.
- Insufficient scopes fail.
- Plaintext secrets are revealed only once.
- Tenant A cannot access Tenant B's resources.

### Milestone 5: Endpoint management and subscriptions

Tasks:

- Create/list/read/update/disable endpoints.
- Validate and normalize URLs.
- Implement subscription creation and update.
- Generate and encrypt signing secrets.
- Design secret rotation behavior.
- Add SSRF protections before enabling outbound requests.

Exit criteria:

- Endpoint subscriptions route only the intended event types.
- Endpoint updates are tenant-scoped and transactionally consistent.
- Secrets are never returned in ordinary read responses.
- Unsafe destination URLs are rejected or safely constrained.

### Milestone 6: Event ingestion and transactional outbox

Tasks:

- Define the event request contract and payload size limits.
- Implement tenant-scoped idempotency.
- Compute a stable request hash.
- Insert event, matching delivery records, and outbox messages in one transaction.
- Implement event listing/detail and delivery lookup APIs.

Exit criteria:

- Repeating the same request does not create duplicate events or original deliveries.
- Reusing an idempotency key with a different payload returns conflict.
- A forced transaction failure leaves no partial event/delivery/outbox state.
- API response does not wait for customer webhook delivery.

### Milestone 7: Outbox publisher and BullMQ integration

Tasks:

- Configure Redis/BullMQ connection in `packages/queue`.
- Define stable queue names, job names, and versioned job payload schemas.
- Implement an outbox publisher that claims due messages safely.
- Publish jobs with stable identifiers where appropriate.
- Persist publication state and retry failed publication.
- Test duplicate publication and publisher crashes.

Exit criteria:

- Outbox messages are eventually published when Redis recovers.
- Multiple publishers do not corrupt claim state.
- Crash after enqueue but before marking published is safe.
- A duplicate queue job cannot cause duplicate business delivery after the delivery is terminal.

### Milestone 8: Webhook worker and delivery reliability

Tasks:

- Implement BullMQ worker lifecycle and graceful shutdown.
- Validate job payloads.
- Check authoritative delivery state before sending.
- Implement outbound HTTP timeout and response-size limits.
- Persist every delivery attempt.
- Classify retryable and non-retryable failures.
- Configure BullMQ attempts/backoff/delayed retries.
- Persist delivery status and terminal dead-letter business status.
- Define recovery/reconciliation behavior.

Exit criteria:

- Multiple workers process jobs safely.
- Receiver failures are classified and retried according to policy.
- Exhausted deliveries become dead-lettered.
- A worker crash does not permanently lose a delivery.
- Duplicate job execution does not corrupt attempt numbering or terminal state.
- Delivery is explicitly documented as at least once.

### Milestone 9: Signing, replay, and SDK

Tasks:

- Finalize webhook envelope and header contract.
- Implement HMAC-SHA256 signing with timestamp.
- Implement constant-time verification against raw request bytes.
- Implement secret rotation.
- Implement replay as a new delivery linked to the original.
- Build SDK client and `events.send`, `endpoints.create`, `verifyWebhook`.
- Add SDK tests and usable examples.

Exit criteria:

- Valid signatures verify; tampered bodies and stale timestamps fail.
- Replay preserves original history.
- SDK behavior matches API contracts.
- API keys and webhook secrets are never logged.

### Milestone 10: Production-readiness evidence

Tasks:

- Integration and concurrency tests.
- Idempotency tests.
- Outbox crash/recovery tests.
- BullMQ duplicate/stalled-job tests.
- Tenant isolation and SSRF security tests.
- Load benchmarks.
- Structured logs and correlation IDs.
- README and architecture decision records.

Exit criteria:

- Tests cover critical success and failure paths.
- Benchmarks report methodology, environment, p50/p95/p99, throughput, and resource use.
- No performance claims are made without measured evidence.
- Known limitations and operational runbooks are documented.

## Phase 2 — Durable workflow engine

Build after Phase 1 reliability is demonstrated:

- Workflow definitions and versioning.
- Workflow execution records and state machine.
- Durable steps and step results.
- Timers and delayed dispatch through BullMQ.
- Retries and idempotent steps.
- Saga orchestration and compensation.
- Agent execution steps.
- Human approval steps.
- Audit history and workflow visualization.

PostgreSQL is the source of truth for workflow state. BullMQ dispatches runnable work; it does not replace the state machine.

## Phase 3 — Usage metering and billing foundation

Build:

- Usage event collection and deduplication.
- Aggregation windows.
- Pricing rules and effective dates.
- Per-tenant usage.
- Per-run and per-agent token cost.
- Budget limits and enforcement.
- Usage APIs, reports, and audit trails.

Build reliable metering first. Payment processing is a separate later decision; do not let a payment-provider integration replace the metering domain model.

## Phase 4 — AI knowledge layer

Build the Python/FastAPI service with:

- Event/log indexing and ingestion.
- Embeddings.
- Hybrid retrieval.
- Tenant filters and authorization checks.
- Query rewriting.
- Reranking.
- Context assembly.
- Agentic retrieval.
- Retrieval and answer evaluations.
- Tracing, cost, and latency observability.

The AI service must remain outside the critical event-ingestion and webhook-delivery path.

## Later differentiators

- Budget-aware workflow pause/resume.
- Cost per agent run.
- Time-travel replay with alternate prompts/models.
- Production evaluations on replayed executions.
- AI-assisted webhook delivery diagnosis.
- GraphRAG impact analysis across events and workflows.
- Human approvals and auditable decision history.
- Open-source reliability/performance benchmarks.
- Future voice-agent extension.

## Scope control

Do not start future-phase work merely because it is interesting. Finish the current milestone's exit criteria first. If a dependency or architectural decision blocks progress, record the issue and resolve it before expanding scope.
