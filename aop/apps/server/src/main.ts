import { join } from "node:path";
import { AOP_PORTS, AOP_URLS } from "@aop/common";
import { configureLogging, getLogger, initTracing } from "@aop/infra";
import { createServer } from "./api/server.ts";
import { createDatabase, runMigrations } from "./db/connection.ts";
import {
  createWorkflowRepository,
  loadWorkflowsFromDirectory,
  syncWorkflows,
} from "./workflow/index.ts";

const logger = getLogger("main");

const main = async () => {
  const logFormat = process.env.AOP_LOG_FORMAT === "pretty" ? "pretty" : "json";
  await configureLogging({ format: logFormat, serviceName: "server" });
  initTracing("server");

  const port = AOP_PORTS.SERVER;

  logger.info("Starting AOP server on port {port}", { port });

  const db = createDatabase(AOP_URLS.DATABASE);

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
