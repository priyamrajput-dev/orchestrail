import { createDatabaseClient } from "@orchestrail/db";
import { createApplication } from "./app";
import { config } from "./config/env";

async function main() {
  try {
    const dbClient = createDatabaseClient({
      connectionString: config.DATABASE_URL,
    });
    const app = createApplication({ dbClient });

    const server = Bun.serve({
      fetch: app.fetch,
      port: config.PORT,
    });

    console.log(
      `🚀 Http server is running on PORT ${server.port} [env: ${config.NODE_ENV}]`,
    );

    const shutdown = async (signal: string) => {
      console.log(`\nReceived ${signal}. Shutting down gracefully...`);
      server.stop(true);
      await dbClient.close();
      console.log("Server and database connection pool closed.");
      process.exit(0);
    };

    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));
  } catch (error) {
    console.log("Error starting http server");
    throw error;
  }
}

main();
