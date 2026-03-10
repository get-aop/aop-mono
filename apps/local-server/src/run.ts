#!/usr/bin/env bun
import { configureLogging, getLogger, initTracing } from "@aop/infra";
import { getPort } from "./config.ts";
import { startServer } from "./server.ts";

const logger = getLogger("local-server");

const main = async () => {
  await configureLogging({ level: "info", format: "pretty", serviceName: "local-server" });
  initTracing("local-server");
  const port = getPort();
  const handle = await startServer({ port });

  const shutdown = async () => {
    await handle.shutdown();
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
};

main().catch((err) => {
  logger.error(`Failed to start local server: ${String(err)}`);
  process.exit(1);
});
