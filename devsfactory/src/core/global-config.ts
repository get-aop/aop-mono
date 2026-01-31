import { join } from "node:path";
import YAML from "yaml";
import {
  type Config,
  type GlobalConfig,
  GlobalConfigSchema,
  type ProjectConfig,
  ProjectConfigSchema,
  type ProviderConfig
} from "../types";
import { getDefaultConfig, getGlobalDir } from "./global-bootstrap";

type DeepPartial<T> = T extends object
  ? { [P in keyof T]?: DeepPartial<T[P]> }
  : T;

export const deepMerge = <T extends Record<string, unknown>>(
  target: T,
  source: DeepPartial<T>
): T => {
  const result = { ...target };

  for (const key of Object.keys(source) as Array<keyof T>) {
    const sourceValue = (source as T)[key];
    const targetValue = target[key];

    if (sourceValue === undefined) {
      continue;
    }

    if (
      sourceValue !== null &&
      typeof sourceValue === "object" &&
      !Array.isArray(sourceValue) &&
      targetValue !== null &&
      typeof targetValue === "object" &&
      !Array.isArray(targetValue)
    ) {
      result[key] = deepMerge(
        targetValue as Record<string, unknown>,
        sourceValue as Record<string, unknown>
      ) as T[keyof T];
    } else {
      result[key] = sourceValue as T[keyof T];
    }
  }

  return result;
};

export const loadGlobalConfig = async (): Promise<GlobalConfig> => {
  const globalDir = getGlobalDir();
  const configPath = join(globalDir, "config.yaml");

  const configFile = Bun.file(configPath);
  if (!(await configFile.exists())) {
    return getDefaultConfig();
  }

  const content = await configFile.text();
  const parsed = YAML.parse(content);

  return GlobalConfigSchema.parse(parsed);
};

export const loadProjectConfig = async (
  projectName: string
): Promise<ProjectConfig | null> => {
  const globalDir = getGlobalDir();
  const projectPath = join(globalDir, "projects", `${projectName}.yaml`);

  const projectFile = Bun.file(projectPath);
  if (!(await projectFile.exists())) {
    return null;
  }

  const content = await projectFile.text();
  const parsed = YAML.parse(content);

  return ProjectConfigSchema.parse(parsed);
};

interface MergedConfig extends Partial<Config> {
  providers?: Record<string, ProviderConfig>;
}

export const mergeConfigs = (
  global: GlobalConfig,
  project?: ProjectConfig | null
): MergedConfig => {
  const baseConfig: MergedConfig = {
    ...global.defaults,
    providers: global.providers
  };

  if (!project) {
    return baseConfig;
  }

  const projectSettings = project.settings ?? {};
  const projectProviders = project.providers ?? {};

  const mergedSettings = deepMerge(
    baseConfig as Record<string, unknown>,
    projectSettings as Record<string, unknown>
  ) as MergedConfig;

  const mergedProviders = deepMerge(
    global.providers as Record<string, unknown>,
    projectProviders as Record<string, unknown>
  ) as Record<string, ProviderConfig>;

  return {
    ...mergedSettings,
    providers: mergedProviders
  };
};

const applyEnvOverrides = (config: MergedConfig): MergedConfig => {
  const result = { ...config };

  if (process.env.MAX_CONCURRENT_AGENTS) {
    result.maxConcurrentAgents = Number(process.env.MAX_CONCURRENT_AGENTS);
  }

  if (process.env.DEBOUNCE_MS) {
    result.debounceMs = Number(process.env.DEBOUNCE_MS);
  }

  const hasRetryOverrides =
    process.env.RETRY_INITIAL_MS ||
    process.env.RETRY_MAX_MS ||
    process.env.RETRY_MAX_ATTEMPTS;

  if (hasRetryOverrides) {
    result.retryBackoff = {
      initialMs:
        Number(process.env.RETRY_INITIAL_MS) ||
        result.retryBackoff?.initialMs ||
        2000,
      maxMs:
        Number(process.env.RETRY_MAX_MS) ||
        result.retryBackoff?.maxMs ||
        300000,
      maxAttempts:
        Number(process.env.RETRY_MAX_ATTEMPTS) ||
        result.retryBackoff?.maxAttempts ||
        5
    };
  }

  return result;
};

export const resolveConfig = async (
  projectName?: string
): Promise<MergedConfig> => {
  const globalConfig = await loadGlobalConfig();

  let projectConfig: ProjectConfig | null = null;
  if (projectName) {
    projectConfig = await loadProjectConfig(projectName);
  }

  const mergedConfig = mergeConfigs(globalConfig, projectConfig);

  return applyEnvOverrides(mergedConfig);
};
