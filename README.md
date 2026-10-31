# Orchestrail

**Orchestrail is a multi-tenant event, webhook, and workflow platform for applications and AI agents.** Customers send events through an API or SDK. Orchestrail stores them, routes them to subscribed endpoints, delivers webhooks reliably, runs durable workflows, meters usage and cost, and later provides an AI knowledge layer over events and execution history.

AI is an additional intelligence layer. The core event and webhook platform must work without the AI service.

> **Project status:** Early foundation stage. Turborepo and Git have been initialized. The generated scaffold still needs to be inspected before workspace configuration and application setup are finalized. The architecture and APIs in this repository are the intended design, not claims that those features are already implemented.

## Product capabilities

- Multi-tenant event ingestion with API-key authentication and idempotency.
- Event subscriptions and webhook endpoint management.
- Reliable webhook delivery with retries, signatures, replay, and dead-letter handling.
- Durable workflows with timers, retries, saga compensation, and agent steps.
- Usage metering, per-run cost tracking, and budget enforcement.
- Tenant-filtered AI retrieval over events, deliveries, workflows, and logs.

## Technology direction

| Area                     | Technology                       |
| ------------------------ | -------------------------------- |
| Monorepo                 | Bun workspaces + Turborepo       |
| API                      | Bun + Hono + TypeScript + Zod    |
| Background workers       | Bun + BullMQ                     |
| Queue backend            | Redis                            |
| Source-of-truth database | PostgreSQL                       |
| ORM and migrations       | Drizzle ORM + drizzle-kit + `pg` |
| Shared contracts         | TypeScript + Zod                 |
| Customer SDK             | TypeScript + native `fetch`      |
| Dashboard                | Next.js + React + TypeScript     |
| AI service               | Python + FastAPI                 |

## Architecture at a glance

1. A customer sends an event to the Hono API.
2. The API authenticates the tenant, validates the request, and enforces idempotency.
3. One PostgreSQL transaction stores the event, matching delivery records, and outbox messages.
4. An outbox publisher reads unpublished messages and publishes jobs to BullMQ in Redis.
5. Bun workers consume jobs, send signed HTTP requests, and persist delivery attempts and outcomes in PostgreSQL.
6. The dashboard reads customer-visible state through the API.
7. The AI service is introduced later and retrieves only data authorized for the requesting tenant.

PostgreSQL is the business source of truth. BullMQ + Redis provide queue execution infrastructure. The transactional outbox bridges the PostgreSQL transaction and asynchronous queue publication; it does not make PostgreSQL and Redis one atomic transaction.

## Monorepo target

```text
orchestrail/
├── apps/
│   ├── api/          # Hono API and event ingestion
│   ├── worker/       # Outbox publisher and BullMQ workers
│   ├── web/          # Next.js dashboard
│   └── ai/           # FastAPI retrieval and agent service
├── packages/
│   ├── db/           # Drizzle schemas, client, migrations
│   ├── shared/       # Shared types, Zod schemas, contracts
│   ├── sdk/           # Customer-facing TypeScript SDK
│   └── queue/         # BullMQ queues, job contracts, config
├── docs/
│   ├── ARCHITECTURE.md
│   ├── API.md
│   ├── DATABASE.md
│   ├── ROADMAP.md
│   └── PROJECT_STATUS.md
├── AGENTS.md
├── README.md
├── package.json
└── turbo.json
```

This is the target structure. Inspect the generated Turborepo scaffold before creating or modifying folders and configuration.

## Development prerequisites

The developer has reported the following local versions:

- Bun 1.4.4
- Docker 29.4.0
- Docker Compose 5.1.1
- Git 2.50.1

These are the versions observed during initial setup, not a permanent requirement. Verify compatibility when adding dependencies.

## Local Infrastructure (PostgreSQL & Redis)

Local development uses Docker Compose with:

- **PostgreSQL 18.6** (`postgres:18.6-alpine`) — relational source of truth
- **Redis 8.10.3** (`redis:8.10.3-alpine`) — queue backend for BullMQ

Both services are bound to `127.0.0.1` on the host machine to avoid exposing database ports to the local network.

### 1. Configure Environment Variables

Copy `.env.example` to `.env` in the repository root:

```bash
cp .env.example .env
```

Edit `.env` and set strong development passwords for `POSTGRES_PASSWORD` and `REDIS_PASSWORD`. Missing passwords will cause `compose.yaml` to fail validation immediately.

### 2. Start Services

To launch both containers in detached mode:

```bash
docker compose up -d
```

To check service health and running status:

```bash
docker compose ps
```

Both containers will report `(healthy)` when ready to accept connections.

### 3. Inspect Logs

```bash
# Stream logs from both services
docker compose logs -f

# View logs for a specific service
docker compose logs postgres
docker compose logs redis
```

### 4. Stopping vs Removing Containers

- **Stop containers** (preserves state in memory and volume):
  ```bash
  docker compose stop
  ```
- **Start stopped containers**:
  ```bash
  docker compose start
  ```
- **Remove containers safely** (keeps persistent volumes intact):
  ```bash
  docker compose down
  ```
- **Data Persistence**:
  Data is stored in named Docker volumes (`orchestrail_postgres_data` and `orchestrail_redis_data`). Normal `docker compose down` does **not** destroy your data.
  > [!WARNING]
  > Running `docker compose down -v` deletes persistent volumes and permanently erases all local database and Redis data. Only use `-v` if you intentionally want to reset your local database from scratch.

## Documentation

- [Agent instructions](AGENTS.md) — product context, constraints, and how AI coding agents should work in this repository.
- [Architecture](docs/ARCHITECTURE.md) — service boundaries, event flow, outbox, BullMQ, and reliability.
- [API](docs/API.md) — proposed Phase 1 endpoints and contracts.
- [Database](docs/DATABASE.md) — proposed tables, fields, constraints, and indexes.
- [Roadmap](docs/ROADMAP.md) — phases, milestones, and exit criteria.
- [Project status](docs/PROJECT_STATUS.md) — verified progress and open decisions.

## Explicit implementation boundaries

Build the Orchestrail-specific business logic: event routing, idempotency, transactional outbox, delivery state transitions, retry classification/policy, attempt history, replay semantics, workflow state machine, usage metering, and RAG pipeline.

Use established infrastructure where it is intentionally selected: PostgreSQL, Redis, BullMQ, Hono, FastAPI, Next.js, Drizzle, and model/embedding APIs.

Do not replace the workflow engine with a workflow framework. BullMQ is deliberately selected for queue mechanics, not as the source of truth for workflow state.
