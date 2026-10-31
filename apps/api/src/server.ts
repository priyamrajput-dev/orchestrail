import { createApplication } from "./app";

async function main() {
  try {
    const app = createApplication();
    const PORT: number = Number(process.env.PORT) || 8080;

    const server = Bun.serve({
      fetch: app.fetch,
      port: PORT,
    });

    console.log(`Http server is running on PORT ${server.port}`);
  } catch (error) {
    console.log("Error starting http server");
    throw error;
  }
}

main();
