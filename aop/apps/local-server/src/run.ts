#!/usr/bin/env bun
/* biome-ignore-all lint/suspicious/noConsole: sidecar protocol outputs to stdout */
import { configureLogging, getLogger, initTracing } from "@aop/infra";
import { getPort, getSidecarPortRange } from "./config.ts";
import { startServer } from "./server.ts";

const logger = getLogger("local-server");

const isSidecarMode = () => process.env.AOP_ELECTRON_SIDECAR === "1";

const findAvailablePort = async (startPort: number, endPort: number): Promise<number | null> => {
  for (let port = startPort; port <= endPort; port++) {
    try {
      const testServer = Bun.serve({
        fetch: () => new Response("test"),
        port,
        hostname: "127.0.0.1",
      });
      testServer.stop();
      return port;
    } catch {}
  }
  return null;
};

const main = async () => {
  const sidecarMode = isSidecarMode();

  if (sidecarMode) {
    await configureLogging({ level: "info", format: "json", serviceName: "local-server" });
  } else {
    await configureLogging({ level: "info", format: "pretty", serviceName: "local-server" });
  }

  initTracing("local-server");

  let port: number;
  if (sidecarMode) {
    const { start, end } = getSidecarPortRange();
    const availablePort = await findAvailablePort(start, end);
    if (!availablePort) {
      const errorMsg = `No available ports in range ${start}-${end}`;
      console.log(`AOP_SERVER_ERROR=${errorMsg}`);
      logger.error(errorMsg);
      process.exit(1);
    }
    port = availablePort;
  } else {
    port = getPort();
  }

  const handle = await startServer({ port });

  if (sidecarMode) {
    console.log(`AOP_SERVER_PORT=${port}`);
  }

  const shutdown = async () => {
    await handle.shutdown();
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
};

main().catch((err) => {
  const errorMsg = `Failed to start local server: ${String(err)}`;
  if (isSidecarMode()) {
    console.log(`AOP_SERVER_ERROR=${errorMsg}`);
  }
  logger.error(errorMsg);
  process.exit(1);
});
