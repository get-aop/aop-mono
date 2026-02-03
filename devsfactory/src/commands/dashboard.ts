import { join } from "node:path";
import YAML from "yaml";
import { getGlobalDir } from "../core/global-bootstrap";
import { getLogger } from "../infra/logger";

export interface DashboardArgs {
  help?: boolean;
  port?: number;
  server?: string;
  error?: string;
}

export const parseDashboardArgs = (args: string[]): DashboardArgs => {
  const result: DashboardArgs = {};

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

      case "--server":
        if (nextArg && !nextArg.startsWith("-")) {
          result.server = nextArg;
          i++;
        }
        break;

      default:
        if (arg?.startsWith("-")) {
          result.error = `Unknown option: ${arg}`;
        }
    }
  }

  return result;
};

export const showDashboardHelp = (): void => {
  console.log(`
aop dashboard - Connect to a remote AOP server and display the dashboard UI

USAGE:
  aop dashboard [OPTIONS]

OPTIONS:
  -h, --help              Show this help message
  -p, --port <port>       Local dashboard port (default: 3002)
  --server <url>          Server URL (default: from ~/.aop/config.yaml)

DESCRIPTION:
  The dashboard command starts a local web server that displays the AOP dashboard
  UI and connects to a remote AOP server. This allows you to monitor and manage
  tasks running on a remote orchestrator.

  The server URL can be configured in ~/.aop/config.yaml:
    server:
      url: http://your-server:3001

EXAMPLES:
  # Connect to default server (from config)
  aop dashboard

  # Connect to specific server
  aop dashboard --server http://192.168.1.100:3001

  # Use custom local port
  aop dashboard -p 8080
`);
};

const loadServerUrlFromConfig = async (): Promise<string | null> => {
  try {
    const configPath = join(getGlobalDir(), "config.yaml");
    const file = Bun.file(configPath);
    if (!(await file.exists())) {
      return null;
    }
    const content = await file.text();
    const config = YAML.parse(content);
    return config?.server?.url ?? null;
  } catch {
    return null;
  }
};

export const runDashboard = async (args: DashboardArgs): Promise<void> => {
  const log = getLogger("dashboard");

  const port = args.port ?? Number(process.env.DASHBOARD_LOCAL_PORT ?? 3002);

  // Get server URL from args, env, or config
  let serverUrl: string | undefined =
    args.server ?? process.env.AOP_SERVER_URL ?? undefined;
  if (!serverUrl) {
    serverUrl = (await loadServerUrlFromConfig()) ?? undefined;
  }
  if (!serverUrl) {
    serverUrl = "http://localhost:3001";
  }

  log.info("Starting dashboard client");
  log.info(`Server URL: ${serverUrl}`);
  log.info(`Local port: ${port}`);

  console.log("");
  console.log("Starting AOP Dashboard Client...");
  console.log(`  Local port: ${port}`);
  console.log(`  Server: ${serverUrl}`);
  console.log("");

  // Import the dashboard client server
  const { DashboardClientServer } = await import(
    "../core/dashboard-client-server"
  );

  const dashboard = new DashboardClientServer({
    port,
    serverUrl
  });

  await dashboard.start();

  console.log(`Dashboard: http://localhost:${dashboard.port}`);
  console.log(`Connected to server: ${serverUrl}`);
  console.log("");
  console.log("Dashboard is running. Press Ctrl+C to stop.");

  const shutdown = async () => {
    console.log("\nShutting down...");
    await dashboard.stop();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Keep running
  await new Promise(() => {});
};

export const dashboardCommand = async (args: string[]): Promise<void> => {
  const parsed = parseDashboardArgs(args);

  if (parsed.help) {
    showDashboardHelp();
    return;
  }

  if (parsed.error) {
    console.error(`Error: ${parsed.error}`);
    process.exit(1);
  }

  await runDashboard(parsed);
};
