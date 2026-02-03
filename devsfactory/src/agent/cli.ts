import { getProject } from "../core/project-registry";
import { AgentClient } from "./agent-client";
import {
  type AgentConfig,
  generateSecret,
  getDefaultConfigPath,
  loadConfig,
  saveConfig
} from "./agent-config";

/**
 * Agent CLI arguments
 */
export interface AgentCliArgs {
  help?: boolean;
  version?: boolean;
  init?: boolean;
  config?: string;
  server?: string;
  secret?: string;
  model?: string;
  projectName?: string;
  devsfactoryDir?: string;
}

/**
 * Parse agent CLI arguments
 */
export const parseAgentArgs = (args: string[]): AgentCliArgs => {
  const result: AgentCliArgs = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];

    switch (arg) {
      case "-h":
      case "--help":
        result.help = true;
        break;

      case "-v":
      case "--version":
        result.version = true;
        break;

      case "--init":
        result.init = true;
        break;

      case "-c":
      case "--config":
        if (nextArg && !nextArg.startsWith("-")) {
          result.config = nextArg;
          i++;
        }
        break;

      case "-s":
      case "--server":
        if (nextArg && !nextArg.startsWith("-")) {
          result.server = nextArg;
          i++;
        }
        break;

      case "--secret":
        if (nextArg && !nextArg.startsWith("-")) {
          result.secret = nextArg;
          i++;
        }
        break;

      case "-m":
      case "--model":
        if (nextArg && !nextArg.startsWith("-")) {
          result.model = nextArg;
          i++;
        }
        break;

      case "--project-name":
        if (nextArg && !nextArg.startsWith("-")) {
          result.projectName = nextArg;
          i++;
        }
        break;

      case "--devsfactory-dir":
        if (nextArg && !nextArg.startsWith("-")) {
          result.devsfactoryDir = nextArg;
          i++;
        }
        break;
    }
  }

  return result;
};

/**
 * Show help message
 */
export const showHelp = (): void => {
  console.log(`
AOP Agent - Connect to a remote server and execute Claude CLI jobs

USAGE:
  aop agent [OPTIONS]
  aop agent --init [--server <url>] --project-name <name> [--devsfactory-dir <path>]

OPTIONS:
  -h, --help                   Show this help message
  -v, --version                Show version
  --init                       Initialize agent configuration
  -c, --config <path>          Path to config file (default: ~/.aop/config.yaml)
  -s, --server <url>           Server URL (e.g., wss://server.example.com/api/agents)
  --secret <secret>            Authentication secret
  -m, --model <model>          Default model (opus, sonnet, haiku)
  --max-jobs <n>               Maximum concurrent jobs (default: 1)
  --log-level <level>          Log level (debug, info, warn, error)
  --no-reconnect               Disable automatic reconnection
  --project-name <name>        Project name (REQUIRED)
  --devsfactory-dir <path>     Path to .devsfactory directory (optional, derived from project)

ENVIRONMENT VARIABLES:
  AOP_SERVER_URL          Server URL
  AOP_SECRET              Authentication secret
  AOP_CLIENT_ID           Client ID
  AOP_MACHINE_ID          Machine ID
  AOP_MODEL               Default model
  AOP_MAX_CONCURRENT_JOBS Maximum concurrent jobs
  AOP_LOG_LEVEL           Log level
  AOP_PROJECT_NAME        Project name
  AOP_DEVSFACTORY_DIR     Path to .devsfactory directory

EXAMPLES:
  # Initialize agent configuration
  aop agent --init --server wss://my-server.example.com/api/agents \\
    --project-name my-project --devsfactory-dir /path/to/project/.devsfactory

  # Start the agent
  aop agent

  # Start with specific server and project
  aop agent --server wss://localhost:3001/api/agents --secret mysecret \\
    --project-name my-project --devsfactory-dir /path/to/project/.devsfactory

CONFIGURATION:
  The agent looks for configuration in the following order:
  1. Command line arguments
  2. Environment variables
  3. Config file (~/.aop/config.yaml under the 'agent' key)

  Note: --project-name is required. The --devsfactory-dir is derived from the
  registered project path if not provided (run 'aop init' first).
`);
};

/**
 * Initialize agent configuration interactively
 */
export const initAgent = async (
  serverUrl?: string,
  projectName?: string,
  _devsfactoryDir?: string
): Promise<{ success: boolean; error?: string }> => {
  const configPath = getDefaultConfigPath();

  // Check if agent config already exists in config.yaml
  const existingFile = Bun.file(configPath);
  if (await existingFile.exists()) {
    const content = await existingFile.text();
    const parsed = (await import("yaml")).default.parse(content);
    if (parsed?.agent) {
      console.log(`Agent configuration already exists in ${configPath}`);
      console.log(
        "Remove the 'agent' section from the file if you want to reinitialize."
      );
      return { success: false, error: "Agent config already exists" };
    }
  }

  // Validate required fields
  if (!projectName) {
    console.error(
      "Error: --project-name is required for agent initialization."
    );
    return {
      success: false,
      error: "Missing required field: projectName"
    };
  }

  // Get project path from registry
  const project = await getProject(projectName);
  if (!project) {
    console.error(
      `Error: Project '${projectName}' not found. Run 'aop init' in the project directory first.`
    );
    return {
      success: false,
      error: `Project '${projectName}' not found`
    };
  }

  // Generate a new secret
  const secret = generateSecret();

  // Create config
  const config: AgentConfig = {
    serverUrl: serverUrl ?? "wss://localhost:3001/api/agents",
    secret,
    maxConcurrentJobs: 1,
    reconnect: true,
    logLevel: "info",
    projectName,
    repoPath: project.path
  };

  await saveConfig(config, configPath);

  console.log(`Agent configuration added to ${configPath}`);
  console.log("");
  console.log("Your agent secret (add this to the server):");
  console.log(`  ${secret}`);
  console.log("");
  console.log("To start the agent, run:");
  console.log("  aop agent");
  console.log("");

  if (!serverUrl) {
    console.log(
      "Note: Update agent.serverUrl in config.yaml to match your server."
    );
  }

  return { success: true };
};

/**
 * Run the agent
 */
export const runAgent = async (args: string[]): Promise<void> => {
  const parsed = parseAgentArgs(args);

  if (parsed.help) {
    showHelp();
    return;
  }

  if (parsed.version) {
    console.log("AOP Agent v1.0.0");
    return;
  }

  if (parsed.init) {
    const result = await initAgent(
      parsed.server,
      parsed.projectName,
      parsed.devsfactoryDir
    );
    if (!result.success) {
      process.exit(1);
    }
    return;
  }

  // Load configuration
  const configResult = await loadConfig(args, parsed.config);

  if ("error" in configResult) {
    console.error(`Error: ${configResult.error}`);
    console.error("");
    console.error("Run 'aop agent --init' to create a configuration file.");
    process.exit(1);
  }

  const config = configResult.config;

  console.log(`AOP Agent starting...`);
  console.log(`  Server: ${config.serverUrl}`);
  console.log(`  Machine: ${config.machineId ?? "unknown"}`);
  console.log(`  Model: ${config.model ?? "opus"}`);
  console.log("");

  // Create and start client
  const client = new AgentClient(config);

  // Setup event handlers
  client.on("connected", ({ agentId }) => {
    console.log(`Connected to server as ${agentId}`);
  });

  client.on("disconnected", ({ reason }) => {
    console.log(`Disconnected: ${reason}`);
    if (!config.reconnect) {
      process.exit(0);
    }
  });

  client.on("error", ({ error }) => {
    console.error(`Error: ${error.message}`);
  });

  client.on("jobStarted", ({ jobId, taskFolder }) => {
    console.log(`Job started: ${jobId} (${taskFolder})`);
  });

  client.on("jobCompleted", ({ jobId, exitCode }) => {
    console.log(`Job completed: ${jobId} (exit code: ${exitCode})`);
  });

  client.on("jobFailed", ({ jobId, error }) => {
    console.error(`Job failed: ${jobId} - ${error}`);
  });

  // Handle signals
  const shutdown = () => {
    console.log("\nShutting down...");
    client.disconnect();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Connect
  try {
    await client.connect();
    console.log("Waiting for jobs...");

    // Keep the process running
    await new Promise(() => {});
  } catch (error) {
    console.error(
      `Failed to connect: ${error instanceof Error ? error.message : String(error)}`
    );
    process.exit(1);
  }
};
