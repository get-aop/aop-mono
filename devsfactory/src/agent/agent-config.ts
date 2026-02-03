import { randomUUID } from "node:crypto";
import { homedir, hostname } from "node:os";
import { join } from "node:path";
import YAML from "yaml";
import { z } from "zod";
import { getProject } from "../core/project-registry";
import { GlobalConfigSchema } from "../types";

/**
 * Agent configuration schema (runtime - includes required fields with defaults)
 */
export const AgentConfigSchema = z.object({
  serverUrl: z.string().url(),
  secret: z.string().min(16),
  clientId: z.string().optional(),
  machineId: z.string().optional(),
  model: z.enum(["opus", "sonnet", "haiku"]).optional(),
  maxConcurrentJobs: z.number().min(1).max(10).default(1),
  reconnect: z.boolean().default(true),
  logLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),
  projectName: z.string(),
  repoPath: z.string(), // Path to the git repository
  devsfactoryDir: z.string().optional() // Deprecated: use repoPath instead
});

export type AgentConfig = z.infer<typeof AgentConfigSchema>;

/**
 * Default configuration file path (now points to config.yaml)
 */
export const getDefaultConfigPath = (): string => {
  return join(homedir(), ".aop", "config.yaml");
};

/**
 * Load configuration from a YAML file (reads agent section from config.yaml)
 */
export const loadConfigFromFile = async (
  path: string
): Promise<Partial<AgentConfig> | null> => {
  try {
    const file = Bun.file(path);
    if (!(await file.exists())) {
      return null;
    }

    const content = await file.text();
    const parsed = YAML.parse(content);
    const globalResult = GlobalConfigSchema.safeParse(parsed);

    if (!globalResult.success) {
      return null;
    }

    const agentSection = globalResult.data.agent;
    if (!agentSection) {
      return null;
    }

    return agentSection;
  } catch {
    return null;
  }
};

/**
 * Load configuration from environment variables
 */
export const loadConfigFromEnv = (): Partial<AgentConfig> => {
  const config: Partial<AgentConfig> = {};

  if (process.env.AOP_SERVER_URL) {
    config.serverUrl = process.env.AOP_SERVER_URL;
  }

  if (process.env.AOP_SECRET) {
    config.secret = process.env.AOP_SECRET;
  }

  if (process.env.AOP_CLIENT_ID) {
    config.clientId = process.env.AOP_CLIENT_ID;
  }

  if (process.env.AOP_MACHINE_ID) {
    config.machineId = process.env.AOP_MACHINE_ID;
  }

  if (process.env.AOP_MODEL) {
    const model = process.env.AOP_MODEL.toLowerCase();
    if (model === "opus" || model === "sonnet" || model === "haiku") {
      config.model = model;
    }
  }

  if (process.env.AOP_MAX_CONCURRENT_JOBS) {
    const val = parseInt(process.env.AOP_MAX_CONCURRENT_JOBS, 10);
    if (!Number.isNaN(val) && val >= 1 && val <= 10) {
      config.maxConcurrentJobs = val;
    }
  }

  if (process.env.AOP_LOG_LEVEL) {
    const level = process.env.AOP_LOG_LEVEL.toLowerCase();
    if (["debug", "info", "warn", "error"].includes(level)) {
      config.logLevel = level as AgentConfig["logLevel"];
    }
  }

  if (process.env.AOP_PROJECT_NAME) {
    config.projectName = process.env.AOP_PROJECT_NAME;
  }

  if (process.env.AOP_DEVSFACTORY_DIR) {
    config.devsfactoryDir = process.env.AOP_DEVSFACTORY_DIR;
  }

  if (process.env.AOP_REPO_PATH) {
    config.repoPath = process.env.AOP_REPO_PATH;
  }

  return config;
};

/**
 * Load configuration from command line arguments
 */
export const loadConfigFromArgs = (args: string[]): Partial<AgentConfig> => {
  const config: Partial<AgentConfig> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];

    switch (arg) {
      case "--server":
      case "-s":
        if (nextArg && !nextArg.startsWith("-")) {
          config.serverUrl = nextArg;
          i++;
        }
        break;

      case "--secret":
        if (nextArg && !nextArg.startsWith("-")) {
          config.secret = nextArg;
          i++;
        }
        break;

      case "--client-id":
        if (nextArg && !nextArg.startsWith("-")) {
          config.clientId = nextArg;
          i++;
        }
        break;

      case "--machine-id":
        if (nextArg && !nextArg.startsWith("-")) {
          config.machineId = nextArg;
          i++;
        }
        break;

      case "--model":
      case "-m":
        if (nextArg && !nextArg.startsWith("-")) {
          const model = nextArg.toLowerCase();
          if (model === "opus" || model === "sonnet" || model === "haiku") {
            config.model = model;
          }
          i++;
        }
        break;

      case "--max-jobs":
        if (nextArg && !nextArg.startsWith("-")) {
          const val = parseInt(nextArg, 10);
          if (!Number.isNaN(val) && val >= 1 && val <= 10) {
            config.maxConcurrentJobs = val;
          }
          i++;
        }
        break;

      case "--log-level":
        if (nextArg && !nextArg.startsWith("-")) {
          const level = nextArg.toLowerCase();
          if (["debug", "info", "warn", "error"].includes(level)) {
            config.logLevel = level as AgentConfig["logLevel"];
          }
          i++;
        }
        break;

      case "--no-reconnect":
        config.reconnect = false;
        break;

      case "--project-name":
        if (nextArg && !nextArg.startsWith("-")) {
          config.projectName = nextArg;
          i++;
        }
        break;

      case "--devsfactory-dir":
        if (nextArg && !nextArg.startsWith("-")) {
          config.devsfactoryDir = nextArg;
          i++;
        }
        break;

      case "--repo-path":
        if (nextArg && !nextArg.startsWith("-")) {
          config.repoPath = nextArg;
          i++;
        }
        break;
    }
  }

  return config;
};

/**
 * Merge configuration sources with priority:
 * args > env > file > defaults
 */
export const mergeConfigs = (
  fileConfig: Partial<AgentConfig> | null,
  envConfig: Partial<AgentConfig>,
  argsConfig: Partial<AgentConfig>
): Partial<AgentConfig> => {
  return {
    ...(fileConfig ?? {}),
    ...envConfig,
    ...argsConfig
  };
};

/**
 * Apply defaults and validate configuration
 */
export const finalizeConfig = async (
  partial: Partial<AgentConfig>
): Promise<{ config: AgentConfig } | { error: string }> => {
  // Derive repoPath from project registry if not provided
  let repoPath = partial.repoPath;
  if (!repoPath && partial.projectName) {
    const project = await getProject(partial.projectName);
    if (project) {
      repoPath = project.path;
    }
  }

  // Handle legacy devsfactoryDir - derive repoPath from it
  if (!repoPath && partial.devsfactoryDir) {
    repoPath = join(partial.devsfactoryDir, "..");
  }

  // Apply defaults
  const withDefaults = {
    ...partial,
    repoPath,
    clientId: partial.clientId ?? randomUUID(),
    machineId: partial.machineId ?? hostname(),
    maxConcurrentJobs: partial.maxConcurrentJobs ?? 1,
    reconnect: partial.reconnect ?? true,
    logLevel: partial.logLevel ?? "info"
  };

  const result = AgentConfigSchema.safeParse(withDefaults);

  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join(", ");
    return { error: `Invalid configuration: ${issues}` };
  }

  return { config: result.data };
};

/**
 * Load complete configuration from all sources
 */
export const loadConfig = async (
  args: string[],
  configPath?: string
): Promise<{ config: AgentConfig } | { error: string }> => {
  // Load from file
  const filePath = configPath ?? getDefaultConfigPath();
  const fileConfig = await loadConfigFromFile(filePath);

  // Load from environment
  const envConfig = loadConfigFromEnv();

  // Load from arguments
  const argsConfig = loadConfigFromArgs(args);

  // Merge and finalize
  const merged = mergeConfigs(fileConfig, envConfig, argsConfig);
  return await finalizeConfig(merged);
};

/**
 * Save configuration to YAML file (merges into existing config.yaml)
 */
export const saveConfig = async (
  config: AgentConfig,
  path?: string
): Promise<void> => {
  const filePath = path ?? getDefaultConfigPath();
  const dir = join(filePath, "..");

  await Bun.$`mkdir -p ${dir}`.quiet();

  // Load existing config or create new one
  let existingConfig: Record<string, unknown> = {};
  const file = Bun.file(filePath);
  if (await file.exists()) {
    const content = await file.text();
    existingConfig = YAML.parse(content) ?? {};
  }

  // Add/update agent section
  const updatedConfig = {
    ...existingConfig,
    agent: {
      serverUrl: config.serverUrl,
      secret: config.secret,
      projectName: config.projectName,
      devsfactoryDir: config.devsfactoryDir,
      ...(config.clientId && { clientId: config.clientId }),
      ...(config.machineId && { machineId: config.machineId }),
      ...(config.model && { model: config.model }),
      ...(config.maxConcurrentJobs !== 1 && {
        maxConcurrentJobs: config.maxConcurrentJobs
      }),
      ...(config.reconnect === false && { reconnect: config.reconnect }),
      ...(config.logLevel !== "info" && { logLevel: config.logLevel })
    }
  };

  await Bun.write(filePath, YAML.stringify(updatedConfig));
};

/**
 * Generate a new secret for agent authentication
 */
export const generateSecret = (): string => {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64");
};
