#!/usr/bin/env bun
/**
 * Dev Environment Orchestrator
 *
 * Starts all services needed for development:
 * 1. PostgreSQL via docker-compose
 * 2. AOP Server (apps/server)
 * 3. AOP CLI daemon (apps/cli)
 *
 * Usage:
 *   bun dev              # Start all services
 *   bun dev --db-only    # Start only PostgreSQL
 *   bun dev --no-cli     # Start db + server (no CLI)
 */

import { configureLogging, getLogger } from "@aop/infra";

const log = getLogger("dev", "orchestrator");

interface ParsedArgs {
  dbOnly: boolean;
  noCli: boolean;
}

const parseArgs = (): ParsedArgs => {
  const args = process.argv.slice(2);
  return {
    dbOnly: args.includes("--db-only"),
    noCli: args.includes("--no-cli"),
  };
};

const waitForPostgres = async (maxAttempts = 30): Promise<boolean> => {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const result = await Bun.$`docker exec aop-postgres pg_isready -U aop -d aop`.quiet();
      if (result.exitCode === 0) {
        // Add extra delay to ensure Postgres is fully accepting connections
        await Bun.sleep(2000);
        return true;
      }
    } catch {
      // Container may not be ready yet
    }
    await Bun.sleep(1000);
  }
  return false;
};

const startPostgres = async (): Promise<void> => {
  log.info("Starting PostgreSQL...");
  await Bun.$`docker compose up -d postgres`;

  log.info("Waiting for PostgreSQL to be ready...");
  const ready = await waitForPostgres();
  if (!ready) {
    throw new Error("PostgreSQL failed to start within timeout");
  }
  log.info("PostgreSQL is ready");
};

const stopPostgres = async (): Promise<void> => {
  log.info("Stopping PostgreSQL...");
  await Bun.$`docker compose down`.quiet();
};

interface ProcessHandle {
  name: string;
  proc: Subprocess;
}

type Subprocess = ReturnType<typeof Bun.spawn>;

const startServer = (): ProcessHandle => {
  log.info("Starting AOP server...");
  const proc = Bun.spawn(["bun", "run", "--watch", "./src/main.ts"], {
    cwd: "./apps/server",
    env: {
      ...process.env,
      DATABASE_URL: "postgres://aop:aop@localhost:5433/aop",
      PORT: "3000",
    },
    stdout: "inherit",
    stderr: "inherit",
  });
  return { name: "server", proc };
};

const startCli = (): ProcessHandle => {
  log.info("Starting AOP CLI daemon...");
  const proc = Bun.spawn(["bun", "run", "./src/main.ts", "daemon"], {
    cwd: "./apps/cli",
    env: {
      ...process.env,
      AOP_SERVER_URL: "http://localhost:3000",
      AOP_API_KEY: "aop_test_key_dev",
    },
    stdout: "inherit",
    stderr: "inherit",
  });
  return { name: "cli", proc };
};

const shutdown = async (processes: ProcessHandle[], includeDb: boolean): Promise<void> => {
  log.info("Shutting down...");

  for (const { name, proc } of processes) {
    log.info("Stopping {name}...", { name });
    proc.kill();
    await proc.exited;
  }

  if (includeDb) {
    await stopPostgres();
  }

  log.info("Shutdown complete");
};

const main = async () => {
  await configureLogging({ format: "pretty" });

  const { dbOnly, noCli } = parseArgs();

  await startPostgres();

  if (dbOnly) {
    log.info("Database started. Press Ctrl+C to stop.");
    process.on("SIGINT", async () => {
      await stopPostgres();
      process.exit(0);
    });
    await Bun.sleep(Number.MAX_SAFE_INTEGER);
    return;
  }

  const processes: ProcessHandle[] = [];

  processes.push(startServer());
  await Bun.sleep(2000);

  if (!noCli) {
    processes.push(startCli());
  }

  log.info("Dev environment started. Press Ctrl+C to stop.");

  process.on("SIGINT", async () => {
    await shutdown(processes, true);
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    await shutdown(processes, true);
    process.exit(0);
  });

  await Promise.all(processes.map(({ proc }) => proc.exited));
};

main().catch(async (err) => {
  await configureLogging({ level: "error" });
  log.fatal("Fatal error: {error}", { error: String(err) });
  process.exit(1);
});
