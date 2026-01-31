import { dirname, join } from "node:path";

export interface DockerRunnerOptions {
  composeFile?: string;
  dashboardPort?: number;
  maxConcurrentAgents?: number;
}

interface ContainerStatus {
  orchestrator: "running" | "stopped" | "starting" | "unhealthy";
}

const DEFAULT_OPTIONS: Required<DockerRunnerOptions> = {
  composeFile: getDefaultComposeFilePath(),
  dashboardPort: 3001,
  maxConcurrentAgents: 2
};

function getDefaultComposeFilePath(): string {
  const currentDir = dirname(new URL(import.meta.url).pathname);
  return join(currentDir, "..", "..", "docker-compose.yml");
}

export const getProjectRoot = (): string => {
  const currentDir = dirname(new URL(import.meta.url).pathname);
  return join(currentDir, "..", "..");
};

export const isDockerInstalled = async (): Promise<boolean> => {
  try {
    const result = await Bun.$`docker --version`.quiet();
    return result.exitCode === 0;
  } catch {
    return false;
  }
};

export const isDockerComposeInstalled = async (): Promise<boolean> => {
  try {
    const result = await Bun.$`docker compose version`.quiet();
    return result.exitCode === 0;
  } catch {
    return false;
  }
};

export const getContainerStatus = async (
  options: DockerRunnerOptions = {}
): Promise<ContainerStatus> => {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const projectRoot = getProjectRoot();

  try {
    const result =
      await Bun.$`docker compose -f ${opts.composeFile} ps --format json`
        .cwd(projectRoot)
        .quiet();

    if (result.exitCode !== 0) {
      return { orchestrator: "stopped" };
    }

    const output = result.stdout.toString().trim();
    if (!output) {
      return { orchestrator: "stopped" };
    }

    const containers = output
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line));

    const getStatus = (
      name: string
    ): "running" | "stopped" | "starting" | "unhealthy" => {
      const container = containers.find((c: { Service?: string }) =>
        c.Service?.includes(name)
      );
      if (!container) return "stopped";
      const state = container.State as string;
      const health = container.Health as string;
      if (state === "running" && health === "healthy") return "running";
      if (state === "running" && health === "starting") return "starting";
      if (state === "running" && health === "unhealthy") return "unhealthy";
      if (state === "running") return "starting";
      return "stopped";
    };

    return {
      orchestrator: getStatus("orchestrator")
    };
  } catch {
    return { orchestrator: "stopped" };
  }
};

export const startContainers = async (
  options: DockerRunnerOptions = {},
  onProgress?: (message: string) => void
): Promise<{ success: boolean; error?: string }> => {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const projectRoot = getProjectRoot();

  if (!(await isDockerInstalled())) {
    return {
      success: false,
      error:
        "Docker is not installed. Please install Docker and try again.\nhttps://docs.docker.com/get-docker/"
    };
  }

  if (!(await isDockerComposeInstalled())) {
    return {
      success: false,
      error:
        "Docker Compose is not installed. Please install Docker Compose and try again."
    };
  }

  const status = await getContainerStatus(opts);
  if (status.orchestrator === "running") {
    onProgress?.("Orchestrator already running");
    return { success: true };
  }

  onProgress?.("Building and starting orchestrator...");

  try {
    const env = {
      ...process.env,
      DASHBOARD_PORT: String(opts.dashboardPort),
      MAX_CONCURRENT_AGENTS: String(opts.maxConcurrentAgents)
    };

    const buildResult = await Bun.$`docker compose -f ${opts.composeFile} build`
      .cwd(projectRoot)
      .env(env)
      .quiet();

    if (buildResult.exitCode !== 0) {
      return {
        success: false,
        error: `Failed to build containers:\n${buildResult.stderr.toString()}`
      };
    }

    onProgress?.("Starting orchestrator...");

    const startResult = await Bun.$`docker compose -f ${opts.composeFile} up -d`
      .cwd(projectRoot)
      .env(env)
      .quiet();

    if (startResult.exitCode !== 0) {
      return {
        success: false,
        error: `Failed to start orchestrator:\n${startResult.stderr.toString()}`
      };
    }

    onProgress?.("Waiting for orchestrator to be healthy...");

    const healthy = await waitForHealthy(opts, 60);
    if (!healthy) {
      return {
        success: false,
        error: "Orchestrator failed to become healthy within 60 seconds"
      };
    }

    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: `Failed to start containers: ${err instanceof Error ? err.message : String(err)}`
    };
  }
};

export const stopContainers = async (
  options: DockerRunnerOptions = {}
): Promise<{ success: boolean; error?: string }> => {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const projectRoot = getProjectRoot();

  try {
    const result = await Bun.$`docker compose -f ${opts.composeFile} down`
      .cwd(projectRoot)
      .quiet();

    if (result.exitCode !== 0) {
      return {
        success: false,
        error: `Failed to stop containers:\n${result.stderr.toString()}`
      };
    }

    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: `Failed to stop containers: ${err instanceof Error ? err.message : String(err)}`
    };
  }
};

const waitForHealthy = async (
  options: DockerRunnerOptions,
  timeoutSeconds: number
): Promise<boolean> => {
  const startTime = Date.now();
  const timeoutMs = timeoutSeconds * 1000;

  while (Date.now() - startTime < timeoutMs) {
    const status = await getContainerStatus(options);
    if (status.orchestrator === "running") {
      return true;
    }

    if (status.orchestrator === "unhealthy") {
      return false;
    }

    await Bun.sleep(1000);
  }

  return false;
};

export const getContainerLogs = async (
  service: "orchestrator",
  options: DockerRunnerOptions = {},
  tail: number = 50
): Promise<string> => {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const projectRoot = getProjectRoot();

  try {
    const result =
      await Bun.$`docker compose -f ${opts.composeFile} logs --tail ${tail} ${service}`
        .cwd(projectRoot)
        .quiet();

    return result.stdout.toString();
  } catch {
    return "";
  }
};
