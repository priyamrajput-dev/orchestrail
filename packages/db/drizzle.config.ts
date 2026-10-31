import { defineConfig } from "drizzle-kit";
import * as dotenv from "dotenv";
import * as path from "node:path";

dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL environment variable is required to run Drizzle Kit commands.",
  );
}

export default defineConfig({
  dialect: "postgresql",
  schema: path.resolve(__dirname, "src/schema/index.ts"),
  out: path.resolve(__dirname, "drizzle"),
  dbCredentials: {
    url: databaseUrl,
  },
  verbose: true,
});
