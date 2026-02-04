import { join } from "node:path";
import { configureLogging, getLogger } from "@aop/infra";
import { createServer } from "./api/server.ts";
import { createDatabase, runMigrations } from "./db/connection.ts";
import {
  createWorkflowRepository,
  loadWorkflowsFromDirectory,
  syncWorkflows,
} from "./workflow/index.ts";

const logger = getLogger("aop-server", "main");

const main = async () => {
  await configureLogging({ format: "json" });

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    logger.error("DATABASE_URL environment variable is required");
    process.exit(1);
  }

  const port = Number.parseInt(process.env.PORT ?? "3000", 10);

  logger.info("Starting AOP server on port {port}", { port });

  const db = createDatabase(databaseUrl);

  logger.info("Running database migrations");
  await runMigrations(db);

  logger.info("Syncing workflows from YAML files");
  const workflowsDir = join(import.meta.dirname, "..", "workflows");
  const workflows = await loadWorkflowsFromDirectory(workflowsDir);
  const workflowRepo = createWorkflowRepository(db);
  await syncWorkflows(workflowRepo, workflows);

  const server = createServer({ db, port });

  logger.info("Server started successfully", { port });

  return server;
};

main().catch((error) => {
  logger.error("Failed to start server: {error}", { error: String(error) });
  process.exit(1);
});
