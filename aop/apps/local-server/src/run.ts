#!/usr/bin/env bun

import { configureLogging, getLogger } from "@aop/infra";
import { getPort } from "./config.ts";
import { startServer } from "./server.ts";

const logger = getLogger("aop", "local-server");

const main = async () => {
  await configureLogging({ level: "info", format: "pretty" });
  const handle = await startServer({ port: getPort() });

  const shutdown = async () => {
    await handle.shutdown();
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
};

main().catch((err) => {
  logger.error("Failed to start local server: {error}", { error: String(err) });
  process.exit(1);
});
