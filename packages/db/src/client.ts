import { SQL } from "bun";
import { drizzle } from "drizzle-orm/bun-sql";

export interface DatabaseConfig {
  connectionString?: string;
  max?: number;
  idleTimeout?: number;
  connectTimeout?: number;
  tls?: boolean | object;
}

export type DatabaseInstance = ReturnType<typeof drizzle>;

export interface DatabaseClient {
  db: DatabaseInstance;
  sql: SQL;
  close: () => Promise<void>;
  healthCheck: () => Promise<boolean>;
}

/**
 * Creates an isolated database client using native Bun.SQL and Drizzle ORM.
 * Each application process (e.g. apps/api, apps/worker) should instantiate its own client
 * during startup and close it during graceful shutdown.
 */
export function createDatabaseClient(
  config: DatabaseConfig = {},
): DatabaseClient {
  const connectionUrl = config.connectionString || process.env.DATABASE_URL;

  if (!connectionUrl) {
    throw new Error("Missing PostgreSQL connection string for DatabaseClient");
  }

  // Create native Bun.SQL connection pool
  const sql = new SQL(connectionUrl, {
    max: config.max ?? 20,
    idleTimeout: config.idleTimeout ?? 30,
    connectTimeout: config.connectTimeout ?? 5,
    tls: config.tls,
  });

  const db = drizzle({ client: sql });

  return {
    db,
    sql,
    close: async () => {
      await sql.close();
    },
    healthCheck: async () => {
      const res = await sql`SELECT 1 AS ready`;
      return res.length > 0 && res[0].ready === 1;
    },
  };
}
