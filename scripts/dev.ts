#!/usr/bin/env bun
/**
 * Dev Environment Orchestrator
 *
 * Starts all services needed for development:
 * 1. PostgreSQL via docker-compose
 * 2. AOP Server (apps/server) - remote API server
 * 3. AOP Local Server (apps/local-server) - local task orchestrator
 * 4. Dashboard (apps/dashboard) - web UI with HMR
 *
 * Usage:
 *   bun dev                   # Start all services
 *   bun dev --db-only         # Start only PostgreSQL
 *   bun dev --no-local        # Start db + server (no local-server)
 *   bun dev --no-dashboard    # Start without dashboard
 */

import { resolve } from "node:path";

const ROOT_DIR = resolve(import.meta.dirname, "..");
const ENV_FILE = resolve(ROOT_DIR, ".env");
const ENV_EXAMPLE_FILE = resolve(ROOT_DIR, ".env.example");

const parseEnvFile = (content: string): Map<string, string> => {
  const vars = new Map<string, string>();
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex);
    const value = trimmed.slice(eqIndex + 1);
    vars.set(key, value);
  }
  return vars;
};

const syncEnvFile = async (): Promise<void> => {
  const exampleFile = Bun.file(ENV_EXAMPLE_FILE);
  if (!(await exampleFile.exists())) {
    throw new Error(".env.example not found. Cannot configure environment.");
  }

  const exampleContent = await exampleFile.text();
  const exampleVars = parseEnvFile(exampleContent);

  const envFile = Bun.file(ENV_FILE);
  if (!(await envFile.exists())) {
    await Bun.write(ENV_FILE, exampleContent);
    process.stdout.write("Created .env from .env.example\n");
    return;
  }

  const envContent = await envFile.text();
  const envVars = parseEnvFile(envContent);

  const missingVars: string[] = [];
  for (const [key, value] of exampleVars) {
    if (!envVars.has(key)) {
      missingVars.push(`${key}=${value}`);
    }
  }

  if (missingVars.length > 0) {
    const newContent = `${envContent.trimEnd()}\n\n# Added from .env.example\n${missingVars.join("\n")}\n`;
    await Bun.write(ENV_FILE, newContent);
    const addedKeys = missingVars.map((v) => v.split("=")[0]).join(", ");
    process.stdout.write(`Added missing env vars to .env: ${addedKeys}\n`);
  }
};

const loadEnvFile = async (): Promise<void> => {
  const envFile = Bun.file(ENV_FILE);
  if (!(await envFile.exists())) return;

  const content = await envFile.text();
  const vars = parseEnvFile(content);
  for (const [key, value] of vars) {
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
};

// Sync and load .env before importing modules that depend on env vars
await syncEnvFile();
await loadEnvFile();

import { AOP_PORTS, AOP_URLS } from "@aop/common";
import { configureLogging, getLogger } from "@aop/infra";

const log = getLogger("orchestrator");

interface ParsedArgs {
  dbOnly: boolean;
  noLocal: boolean;
  noDashboard: boolean;
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
    noDashboard: args.includes("--no-dashboard"),
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

const checkDockerAvailability = async (): Promise<void> => {
  try {
    await Bun.$`docker version`.quiet();
  } catch {
    throw new Error(
      "Docker is not installed or not in PATH. Install Docker Desktop from https://docs.docker.com/get-docker/",
    );
  }

  try {
    await Bun.$`docker info`.quiet();
  } catch {
    throw new Error("Docker daemon is not running. Start Docker Desktop and try again.");
  }

  try {
    await Bun.$`docker compose version`.quiet();
  } catch {
    throw new Error(
      "Docker Compose is not available. Install Docker Desktop (includes Compose) from https://docs.docker.com/get-docker/",
    );
  }
};

const startPostgres = async (): Promise<void> => {
  log.info("Starting PostgreSQL...");
  await checkDockerAvailability();
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
    env: { ...process.env, AOP_LOG_FORMAT: "pretty" },
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
      AOP_SERVER_URL: AOP_URLS.SERVER,
      AOP_API_KEY: "aop_test_key_dev",
      AOP_TEST_MODE: "true",
    },
    stdout: "inherit",
    stderr: "inherit",
  });
  return { name: "local-server", proc };
};

const startDashboard = (): ProcessHandle => {
  log.info("Starting AOP dashboard...");
  const proc = Bun.spawn(["bun", "run", "./dev.ts"], {
    cwd: "./apps/dashboard",
    env: {
      ...process.env,
      API_URL: AOP_URLS.LOCAL_SERVER,
    },
    stdout: "inherit",
    stderr: "inherit",
  });
  return { name: "dashboard", proc };
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
  await configureLogging({ format: "pretty", serviceName: "dev" });

  const { dbOnly, noLocal, noDashboard } = parseArgs();

  // Check for existing services on ports we need
  const portsToCheck: number[] = [];
  if (!dbOnly) {
    portsToCheck.push(AOP_PORTS.SERVER);
    if (!noLocal) portsToCheck.push(AOP_PORTS.LOCAL_SERVER);
    if (!noDashboard) portsToCheck.push(AOP_PORTS.DASHBOARD);
  }
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

  if (!noDashboard) {
    processes.push(startDashboard());
    log.info("Dashboard available at {url}", { url: AOP_URLS.DASHBOARD });
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
  await configureLogging({ level: "error", serviceName: "dev" });
  log.fatal("Fatal error: {error}", { error: String(err) });
  process.exit(1);
});
