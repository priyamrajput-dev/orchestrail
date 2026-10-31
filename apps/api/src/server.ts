import { createApplication } from "./app";
import { config } from "./config/env";

async function main() {
  try {
    const app = createApplication();

    const server = Bun.serve({
      fetch: app.fetch,
      port: config.PORT,
    });

    console.log(
      `🚀 Http server is running on PORT ${server.port} [env: ${config.NODE_ENV}]`,
    );
  } catch (error) {
    console.log("Error starting http server");
    throw error;
  }
}

main();
