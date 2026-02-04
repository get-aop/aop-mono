#!/usr/bin/env bun
/**
 * Dev Environment Orchestrator
 *
 * Starts all services needed for development:
 * 1. PostgreSQL via docker-compose
 * 2. AOP Server (apps/server) - remote API server
 * 3. AOP Local Server (apps/local-server) - local task orchestrator
 *
 * Usage:
 *   bun dev                   # Start all services
 *   bun dev --db-only         # Start only PostgreSQL
 *   bun dev --no-local        # Start db + server (no local-server)
 */

import { configureLogging, getLogger } from "@aop/infra";

const log = getLogger("dev", "orchestrator");

const SERVER_PORT = 3000;
const LOCAL_SERVER_PORT = 3847;

interface ParsedArgs {
  dbOnly: boolean;
  noLocal: boolean;
}

interface PortProcess {
  port: number;
  pid: number | null;
  command: string;
}

const isPortInUse = async (port: number): Promise<boolean> => {
  try {
    const server = Bun.serve({
      port,
      fetch: () => new Response(),
    });
    server.stop(true);
    return false;
  } catch {
    return true;
  }
};

const findPidWithLsof = async (port: number): Promise<{ pid: number; command: string } | null> => {
  try {
    const result = await Bun.$`lsof -ti :${port}`.quiet().text();
    const pid = Number(result.trim().split("\n")[0]);
    if (!pid) return null;
    const cmd = await Bun.$`ps -p ${pid} -o comm=`
      .quiet()
      .text()
      .catch(() => "unknown");
    return { pid, command: cmd.trim() || "unknown" };
  } catch {
    return null;
  }
};

const findPidWithSs = async (port: number): Promise<{ pid: number; command: string } | null> => {
  try {
    const result = await Bun.$`ss -tlnp`.quiet().text();
    for (const line of result.split("\n")) {
      if (line.includes(`:${port}`) && line.includes("pid=")) {
        const pidMatch = line.match(/pid=(\d+)/);
        const cmdMatch = line.match(/\("([^"]+)"/);
        if (pidMatch) {
          return { pid: Number(pidMatch[1]), command: cmdMatch?.[1] || "unknown" };
        }
      }
    }
  } catch {
    // ss not available or failed
  }
  return null;
};

const findPidOnPort = async (port: number): Promise<{ pid: number; command: string } | null> => {
  return (await findPidWithLsof(port)) ?? (await findPidWithSs(port));
};

const findProcessesOnPorts = async (ports: number[]): Promise<PortProcess[]> => {
  const results: PortProcess[] = [];
  for (const port of ports) {
    const inUse = await isPortInUse(port);
    if (inUse) {
      const info = await findPidOnPort(port);
      results.push({
        port,
        pid: info?.pid ?? null,
        command: info?.command ?? "unknown",
      });
    }
  }
  return results;
};

const killProcesses = async (processes: PortProcess[]): Promise<boolean> => {
  let allKilled = true;
  for (const { pid, port, command } of processes) {
    if (pid === null) {
      log.warn("Cannot kill process on port {port} - PID unknown. Please kill manually.", { port });
      allKilled = false;
      continue;
    }
    log.info("Killing process {pid} ({command}) on port {port}", { pid, command, port });
    try {
      await Bun.$`kill -9 ${pid}`.quiet();
    } catch {
      log.warn("Failed to kill process {pid}", { pid });
      allKilled = false;
    }
  }
  // Brief pause to let ports release
  await Bun.sleep(500);
  return allKilled;
};

const promptKillServices = async (processes: PortProcess[]): Promise<boolean> => {
  log.warn("Found existing services running:");
  for (const { port, pid, command } of processes) {
    log.warn("  Port {port}: {command} (PID {pid})", { port, command, pid: pid ?? "unknown" });
  }

  process.stdout.write("Kill these services before starting? [Y/n]: ");

  const reader = Bun.stdin.stream().getReader();
  const { value } = await reader.read();
  reader.releaseLock();

  const answer = value ? new TextDecoder().decode(value).trim().toLowerCase() : "";
  return answer === "" || answer === "y" || answer === "yes";
};

const checkAndKillExistingServices = async (ports: number[]): Promise<void> => {
  if (ports.length === 0) return;

  const existingProcesses = await findProcessesOnPorts(ports);
  if (existingProcesses.length === 0) return;

  const shouldKill = await promptKillServices(existingProcesses);
  if (shouldKill) {
    const allKilled = await killProcesses(existingProcesses);
    if (!allKilled) {
      log.info("Some processes could not be killed. Please stop them manually and try again.");
      process.exit(1);
    }
  } else {
    log.info("Aborting. Please stop the services manually and try again.");
    process.exit(0);
  }
};

const parseArgs = (): ParsedArgs => {
  const args = process.argv.slice(2);
  return {
    dbOnly: args.includes("--db-only"),
    noLocal: args.includes("--no-local"),
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
      PORT: String(SERVER_PORT),
    },
    stdout: "inherit",
    stderr: "inherit",
  });
  return { name: "server", proc };
};

const startLocalServer = (): ProcessHandle => {
  log.info("Starting AOP local server...");
  const proc = Bun.spawn(["bun", "run", "--watch", "./src/run.ts"], {
    cwd: "./apps/local-server",
    env: {
      ...process.env,
      AOP_SERVER_URL: `http://localhost:${SERVER_PORT}`,
      AOP_API_KEY: "aop_test_key_dev",
      AOP_PORT: String(LOCAL_SERVER_PORT),
    },
    stdout: "inherit",
    stderr: "inherit",
  });
  return { name: "local-server", proc };
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

  const { dbOnly, noLocal } = parseArgs();

  // Check for existing services on ports we need
  const portsToCheck = dbOnly ? [] : noLocal ? [SERVER_PORT] : [SERVER_PORT, LOCAL_SERVER_PORT];
  await checkAndKillExistingServices(portsToCheck);

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

  if (!noLocal) {
    processes.push(startLocalServer());
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
