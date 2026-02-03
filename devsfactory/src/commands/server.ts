import { AopServer } from "../core/aop-server";
import { ensureGlobalDir } from "../core/global-bootstrap";
import { AgentDispatcher, PROTOCOL_VERSION } from "../core/remote";
import { generateSecret } from "../core/remote/auth";
import { ServerCoordinator } from "../core/server-coordinator";
import { InMemoryStateStore } from "../core/server-state-store";
import { configureLogger, getLogger } from "../infra/logger";

export interface ServerArgs {
  help?: boolean;
  port?: number;
  maxAgents?: number;
  secret?: string;
  generateSecret?: boolean;
  error?: string;
}

export const parseServerArgs = (args: string[]): ServerArgs => {
  const result: ServerArgs = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];

    switch (arg) {
      case "-h":
      case "--help":
        result.help = true;
        break;

      case "-p":
      case "--port":
        if (nextArg && !nextArg.startsWith("-")) {
          result.port = parseInt(nextArg, 10);
          i++;
        }
        break;

      case "--max-agents":
        if (nextArg && !nextArg.startsWith("-")) {
          result.maxAgents = parseInt(nextArg, 10);
          i++;
        }
        break;

      case "--secret":
        if (nextArg && !nextArg.startsWith("-")) {
          result.secret = nextArg;
          i++;
        }
        break;

      case "--generate-secret":
        result.generateSecret = true;
        break;

      default:
        if (arg?.startsWith("-")) {
          result.error = `Unknown option: ${arg}`;
        }
    }
  }

  return result;
};

export const showServerHelp = (): void => {
  console.log(`
aop server - Run the stateless AOP server

USAGE:
  aop server [OPTIONS]

OPTIONS:
  -h, --help              Show this help message
  -p, --port <port>       Dashboard port (default: 3001, env: DASHBOARD_PORT)
  --max-agents <n>        Max concurrent agents (default: 2, env: MAX_CONCURRENT_AGENTS)
  --secret <secret>       Shared secret for remote agent auth (env: AOP_REMOTE_SECRET)
  --generate-secret       Generate a new secret and exit

AGENTS:
  The server accepts agent connections at:
    ws://localhost:<port>/api/agents

  Agents authenticate using a shared secret. Generate one with:
    aop server --generate-secret

  Start the server:
    aop server --secret <your-secret>

  On agent machines, run:
    aop agent --server ws://<server-ip>:<port>/api/agents --secret <your-secret>

EXAMPLES:
  # Run server locally (agents run on same machine)
  aop server --secret mysupersecretkey123

  # Generate a secret
  aop server --generate-secret

  # Use environment variables
  AOP_REMOTE_SECRET=mysecret aop server
`);
};

export const runServer = async (args: ServerArgs): Promise<void> => {
  if (args.generateSecret) {
    const secret = generateSecret();
    console.log("Generated secret:");
    console.log(`  ${secret}`);
    console.log("");
    console.log("Use it with:");
    console.log(`  aop server --remote --secret ${secret}`);
    console.log("");
    console.log("Or set environment variable:");
    console.log(`  export AOP_REMOTE_SECRET="${secret}"`);
    return;
  }

  await configureLogger();
  const log = getLogger("orchestrator");

  await ensureGlobalDir();

  const port = args.port ?? Number(process.env.DASHBOARD_PORT ?? 3001);
  const maxConcurrentAgents =
    args.maxAgents ?? Number(process.env.MAX_CONCURRENT_AGENTS ?? 2);
  const remoteSecret =
    args.secret ?? process.env.AOP_REMOTE_SECRET ?? undefined;

  if (!remoteSecret) {
    console.error("Error: --secret or AOP_REMOTE_SECRET is required");
    console.error("");
    console.error("Generate a secret with: aop server --generate-secret");
    process.exit(1);
  }

  log.info("Starting AOP server");
  log.info(`Dashboard port: ${port}`);
  log.info(`Max concurrent agents: ${maxConcurrentAgents}`);
  console.log("");
  console.log("Starting AOP Server...");
  console.log(`  Port: ${port}`);
  console.log(`  Max agents: ${maxConcurrentAgents}`);
  console.log("");

  const dispatcher = new AgentDispatcher({
    secret: remoteSecret,
    serverVersion: PROTOCOL_VERSION
  });
  const store = new InMemoryStateStore();
  const coordinator = new ServerCoordinator(dispatcher, store, {
    maxConcurrentAgents,
    retryBackoff: {
      initialMs: 2000,
      maxMs: 300000,
      maxAttempts: 5
    }
  });
  coordinator.start();

  const dashboard = new AopServer(coordinator, {
    port,
    agentDispatcher: dispatcher
  });

  await dashboard.start();

  console.log("");
  console.log(`Dashboard: http://localhost:${dashboard.port}`);
  console.log(`Agent endpoint: ws://localhost:${dashboard.port}/api/agents`);
  console.log("");
  console.log("To connect an agent from another machine:");
  console.log(
    `  aop agent --server ws://<this-ip>:${dashboard.port}/api/agents --secret <secret>`
  );

  dispatcher.on("agentConnected", (agent) => {
    console.log(
      `\n✓ Agent connected: ${agent.agentId} (machine: ${agent.machineId})`
    );
    console.log(`  Total agents: ${dispatcher.getAgentCount()}`);
  });

  dispatcher.on("agentDisconnected", ({ agentId, reason }) => {
    console.log(`\n✗ Agent disconnected: ${agentId} (${reason})`);
  });

  console.log("");
  console.log("Server is running. Press Ctrl+C to stop.");

  const shutdown = async () => {
    console.log("\nShutting down...");
    await dashboard.stop();
    coordinator.stop();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Keep running
  await new Promise(() => {});
};

export const serverCommand = async (args: string[]): Promise<void> => {
  const parsed = parseServerArgs(args);

  if (parsed.help) {
    showServerHelp();
    return;
  }

  if (parsed.error) {
    console.error(`Error: ${parsed.error}`);
    process.exit(1);
  }

  await runServer(parsed);
};
