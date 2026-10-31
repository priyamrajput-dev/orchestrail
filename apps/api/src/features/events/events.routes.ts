import { Hono } from "hono";
import type { DatabaseClient } from "@orchestrail/db";
import type { AppVariables } from "../../app";
import { requireScope } from "../authentication/require-scope.middleware";
import { EventsHandler } from "./events.handler";
import { EventsRepository } from "./events.repository";
import { EventsService } from "./events.service";

export function createEventsRouter(dbClient: DatabaseClient) {
  const router = new Hono<{ Variables: AppVariables }>();
  const repository = new EventsRepository();
  const service = new EventsService(dbClient, repository);
  const handler = new EventsHandler(service);

  router.post("/", requireScope("events:write"), handler.handleIngestEvent);

  return router;
}
