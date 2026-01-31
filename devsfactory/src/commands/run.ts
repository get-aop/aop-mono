import {
  type DockerRunnerOptions,
  getContainerStatus,
  startContainers,
  stopContainers
} from "../core/docker-runner";

export interface RunArgs {
  help?: boolean;
  stop?: boolean;
  status?: boolean;
  error?: string;
}

export interface RunConfig {
  mode: "global";
  projectName: string;
  projectRoot: string;
  devsfactoryDir: string;
  worktreesDir: string;
}

export const parseRunArgs = (args: string[]): RunArgs => {
  for (const arg of args) {
    if (arg === "-h" || arg === "--help") {
      return { help: true };
    }

    if (arg === "--stop" || arg === "stop") {
      return { stop: true };
    }

    if (arg === "--status" || arg === "status") {
      return { status: true };
    }

    if (arg.startsWith("-")) {
      return { error: `Unknown option: ${arg}` };
    }
  }

  return { help: false };
};

export interface RunResult {
  success: boolean;
  message?: string;
  error?: string;
  dashboardUrl?: string;
}

export const runStart = async (
  options: DockerRunnerOptions = {},
  onProgress?: (message: string) => void
): Promise<RunResult> => {
  const dashboardPort = options.dashboardPort ?? 3001;

  const result = await startContainers(options, onProgress);

  if (!result.success) {
    return {
      success: false,
      error: result.error
    };
  }

  const dashboardUrl = `http://localhost:${dashboardPort}`;

  return {
    success: true,
    dashboardUrl,
    message: `AOP is running!\n\nDashboard: ${dashboardUrl}\n\nNext steps:\n  1. Go to your project directory\n  2. Run 'aop init' to register it\n  3. Run 'aop create-task "your task description"' to create a task`
  };
};

export const runStop = async (
  options: DockerRunnerOptions = {}
): Promise<RunResult> => {
  const result = await stopContainers(options);

  if (!result.success) {
    return {
      success: false,
      error: result.error
    };
  }

  return {
    success: true,
    message: "AOP stopped. Containers have been shut down."
  };
};

export const runStatus = async (
  options: DockerRunnerOptions = {}
): Promise<RunResult> => {
  const status = await getContainerStatus(options);
  const dashboardPort = options.dashboardPort ?? 3001;

  const lines = [
    "AOP Status",
    "----------",
    `Orchestrator: ${formatStatus(status.orchestrator)}`
  ];

  if (status.orchestrator === "running") {
    lines.push("");
    lines.push(`Dashboard: http://localhost:${dashboardPort}`);
  }

  return {
    success: true,
    message: lines.join("\n")
  };
};

const formatStatus = (
  status: "running" | "stopped" | "starting" | "unhealthy"
): string => {
  switch (status) {
    case "running":
      return "Running";
    case "stopped":
      return "Stopped";
    case "starting":
      return "Starting...";
    case "unhealthy":
      return "Unhealthy";
  }
};
