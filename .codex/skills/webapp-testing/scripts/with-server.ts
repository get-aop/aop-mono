#!/usr/bin/env bun

interface ServerConfig {
  command: string;
  port: number;
  process?: ReturnType<typeof Bun.spawn>;
}

interface ParsedArgs {
  servers: ServerConfig[];
  timeout: number;
  command: string[];
  help: boolean;
}

const POLL_INTERVAL = 500;
const DEFAULT_TIMEOUT = 30000;

const log = {
  info: (msg: string) => Bun.write(Bun.stdout, `${msg}\n`),
  error: (msg: string) => Bun.write(Bun.stderr, `${msg}\n`),
};

function printUsage(): void {
  log.info(`
Usage: bun with-server.ts [options] -- <command>

Starts one or more servers, waits for them to be ready, runs a command, then cleans up.

Options:
  --server <cmd>   Server command to run (can be repeated for multiple servers)
  --port <number>  Port to wait for (must match number of --server flags)
  --timeout <ms>   Timeout for server readiness (default: 30000ms)
  --help           Show this help message

Examples:
  # Single server
  bun with-server.ts --server "npm run dev" --port 5173 -- bun test.ts

  # Multiple servers
  bun with-server.ts --server "npm run api" --port 3000 --server "npm run web" --port 5173 -- bun test.ts
`);
}

function parseServerArg(args: string[], index: number): { value: string; nextIndex: number } {
  const value = args[index + 1];
  if (!value) throw new Error("--server requires a command");
  return { value, nextIndex: index + 2 };
}

function parsePortArg(args: string[], index: number): { value: number; nextIndex: number } {
  const raw = args[index + 1];
  if (!raw) throw new Error("--port requires a number");
  const port = Number.parseInt(raw, 10);
  if (Number.isNaN(port) || port <= 0) throw new Error(`Invalid port: ${raw}`);
  return { value: port, nextIndex: index + 2 };
}

function parseTimeoutArg(args: string[], index: number): { value: number; nextIndex: number } {
  const raw = args[index + 1];
  if (!raw) throw new Error("--timeout requires a number");
  return { value: Number.parseInt(raw, 10), nextIndex: index + 2 };
}

function buildServers(commands: string[], ports: number[]): ServerConfig[] {
  if (commands.length !== ports.length) {
    throw new Error(`Mismatch: ${commands.length} servers but ${ports.length} ports`);
  }
  const result: ServerConfig[] = [];
  for (let i = 0; i < commands.length; i++) {
    const command = commands[i];
    const port = ports[i];
    if (command === undefined || port === undefined)
      throw new Error(`Missing command or port for server ${i}`);
    result.push({ command, port });
  }
  return result;
}

function parseArgs(args: string[]): ParsedArgs {
  const serverCommands: string[] = [];
  const ports: number[] = [];
  let timeout = DEFAULT_TIMEOUT;
  let command: string[] = [];
  let i = 0;

  while (i < args.length) {
    const arg = args[i];

    if (arg === "--") {
      command = args.slice(i + 1);
      break;
    }
    if (arg === "--help" || arg === "-h") {
      return { servers: [], timeout, command: [], help: true };
    }
    if (arg === "--server") {
      const result = parseServerArg(args, i);
      serverCommands.push(result.value);
      i = result.nextIndex;
      continue;
    }
    if (arg === "--port") {
      const result = parsePortArg(args, i);
      ports.push(result.value);
      i = result.nextIndex;
      continue;
    }
    if (arg === "--timeout") {
      const result = parseTimeoutArg(args, i);
      timeout = result.value;
      i = result.nextIndex;
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  return {
    servers: buildServers(serverCommands, ports),
    timeout,
    command,
    help: false,
  };
}

async function waitForPort(port: number, timeout: number): Promise<boolean> {
  const start = Date.now();

  while (Date.now() - start < timeout) {
    try {
      const socket = await Bun.connect({
        hostname: "127.0.0.1",
        port,
        socket: {
          data() {},
          open(socket) {
            socket.end();
          },
          close() {},
          error() {},
        },
      });
      socket.end();
      return true;
    } catch {
      await Bun.sleep(POLL_INTERVAL);
    }
  }

  return false;
}

function spawnServer(config: ServerConfig): ReturnType<typeof Bun.spawn> {
  return Bun.spawn(["sh", "-c", config.command], {
    stdout: "inherit",
    stderr: "inherit",
  });
}

function cleanup(servers: ServerConfig[]): void {
  for (const server of servers) {
    if (server.process) {
      server.process.kill();
    }
  }
}

async function startServers(servers: ServerConfig[], timeout: number): Promise<boolean> {
  for (const server of servers) {
    log.info(`Starting server: ${server.command}`);
    server.process = spawnServer(server);

    log.info(`Waiting for port ${server.port}...`);
    const ready = await waitForPort(server.port, timeout);

    if (!ready) {
      log.error(`Error: Port ${server.port} not ready after ${timeout}ms`);
      return false;
    }

    log.info(`Port ${server.port} is ready`);
  }
  return true;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printUsage();
    process.exit(0);
  }

  if (args.servers.length === 0) {
    log.error("Error: At least one --server and --port pair required");
    printUsage();
    process.exit(1);
  }

  if (args.command.length === 0) {
    log.error("Error: No command specified after --");
    printUsage();
    process.exit(1);
  }

  process.on("SIGINT", () => {
    cleanup(args.servers);
    process.exit(130);
  });
  process.on("SIGTERM", () => {
    cleanup(args.servers);
    process.exit(143);
  });

  try {
    const serversReady = await startServers(args.servers, args.timeout);
    if (!serversReady) {
      cleanup(args.servers);
      process.exit(1);
    }

    log.info(`Running command: ${args.command.join(" ")}`);
    const proc = Bun.spawn(args.command, {
      stdout: "inherit",
      stderr: "inherit",
    });

    const exitCode = await proc.exited;
    cleanup(args.servers);
    process.exit(exitCode);
  } catch (error) {
    log.error(`Error: ${error}`);
    cleanup(args.servers);
    process.exit(1);
  }
}

main();
