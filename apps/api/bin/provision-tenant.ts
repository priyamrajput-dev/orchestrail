#!/usr/bin/env bun
import { createDatabaseClient } from "@orchestrail/db";
import { config } from "../src/config/env";
import { provisionTenant } from "../src/features/tenants/tenant-provisioning.service";

async function main() {
  const args = process.argv.slice(2);

  const getArg = (flag: string) => {
    const idx = args.indexOf(flag);
    return idx !== -1 && args[idx + 1] ? args[idx + 1] : null;
  };

  const name = getArg("--name") || args[0];
  const slug = getArg("--slug") || args[1];
  const keyName = getArg("--key-name") || "Initial Admin Key";
  const rateLimit = Number(getArg("--rate-limit")) || 1000;

  if (!name || !slug) {
    console.log(
      "Usage: bun run provision:tenant --name <name> --slug <slug> [--rate-limit <n>] [--key-name <key>]",
    );
    console.log(
      "Example: bun run provision:tenant --name 'Acme Inc' --slug 'acme'",
    );
    process.exit(1);
  }

  const dbClient = createDatabaseClient({
    connectionString: config.DATABASE_URL,
  });

  try {
    const result = await provisionTenant(dbClient, {
      name,
      slug,
      eventRateLimitPerMinute: rateLimit,
      initialKeyName: keyName,
    });

    console.log("\n=======================================================");
    console.log("🎉 Tenant provisioned successfully!");
    console.log("=======================================================");
    console.log(`Tenant ID:     ${result.tenant.id}`);
    console.log(`Name:          ${result.tenant.name}`);
    console.log(`Slug:          ${result.tenant.slug}`);
    console.log(`Rate Limit:    ${result.tenant.eventRateLimitPerMinute}/min`);
    console.log("-------------------------------------------------------");
    console.log(`Key Name:      ${result.apiKey.name}`);
    console.log(`Key ID:        ${result.apiKey.id}`);
    console.log(`Key Prefix:    ${result.apiKey.keyPrefix}`);
    console.log(`Scopes:        ${result.apiKey.scopes.join(", ")}`);
    console.log("-------------------------------------------------------");
    console.log(
      "⚠️  SAVE THIS PLAINTEXT API KEY NOW. IT WILL NEVER BE SHOWN AGAIN:",
    );
    console.log(`\n  ${result.apiKey.plaintextKey}\n`);
    console.log("=======================================================\n");
  } catch (error: any) {
    console.error("\n❌ Failed to provision tenant:", error.message);
    process.exit(1);
  } finally {
    await dbClient.close();
  }
}

main();
