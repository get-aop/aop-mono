#!/usr/bin/env bun

import { mkdir, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { registerCommands, setupLogging } from "@aop/cli/commands";
import { configureLogging, getLogger } from "@aop/infra";
import { startServer } from "@aop/local-server/server";
import cac from "cac";

declare const BUILD_VERSION: string;

const logger = getLogger("aop", "entrypoint");

const AOP_DIR = join(homedir(), ".aop");
const PID_FILE = join(AOP_DIR, "server.pid");
const LOG_DIR = join(AOP_DIR, "logs");

const ensureAopDir = async (): Promise<void> => {
  await mkdir(AOP_DIR, { recursive: true });
};

const writePidFile = async (pid: number): Promise<void> => {
  await ensureAopDir();
  await Bun.write(PID_FILE, String(pid));
};

const readPidFile = async (): Promise<number | null> => {
  const file = Bun.file(PID_FILE);
  if (!(await file.exists())) return null;
  const content = await file.text();
  const pid = Number.parseInt(content.trim(), 10);
  return Number.isNaN(pid) ? null : pid;
};

const removePidFile = async (): Promise<void> => {
  try {
    await unlink(PID_FILE);
  } catch {
    // PID file already gone
  }
};

const isProcessRunning = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const resolveDashboardPath = async (): Promise<string | undefined> => {
  const embedded = join(dirname(process.execPath), "dashboard");
  const exists = await Bun.file(join(embedded, "index.html")).exists();
  return exists ? embedded : undefined;
};

const cli = cac("aop");

cli
  .command("run", "Start the local server")
  .option("--daemon", "Run in background")
  .option("--port <port>", "Port to listen on")
  .action(async (options: { daemon?: boolean; port?: string }) => {
    if (options.daemon) {
      await ensureAopDir();
      const proc = Bun.spawn([process.execPath, "run"], {
        stdio: ["ignore", "ignore", "ignore"],
        env: {
          ...process.env,
          ...(options.port ? { AOP_PORT: options.port } : {}),
        },
      });
      proc.unref();
      await writePidFile(proc.pid);
      logger.info("Server started in background (PID: {pid})", { pid: proc.pid });
      process.exit(0);
    }

    if (!process.env.AOP_LOG_DIR) {
      process.env.AOP_LOG_DIR = LOG_DIR;
    }
    await setupLogging();

    const port = options.port ? Number.parseInt(options.port, 10) : undefined;
    const dashboardPath = await resolveDashboardPath();

    await startServer({
      port,
      dashboardStaticPath: dashboardPath,
    });
  });

cli.command("stop", "Stop the local server").action(async () => {
  const pid = await readPidFile();

  if (pid === null) {
    logger.info("No server PID file found. Is the server running?");
    process.exit(0);
  }

  if (!isProcessRunning(pid)) {
    logger.info("Server process (PID: {pid}) is not running. Cleaning up PID file.", { pid });
    await removePidFile();
    process.exit(0);
  }

  process.kill(pid, "SIGTERM");
  await removePidFile();
  logger.info("Server stopped (PID: {pid})", { pid });
});

registerCommands(cli);

cli.help();
cli.version(typeof BUILD_VERSION !== "undefined" ? BUILD_VERSION : "dev");

await configureLogging({ level: "info", format: "pretty" });
cli.parse();
