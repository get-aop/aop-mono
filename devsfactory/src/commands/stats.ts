import { exportTaskStats } from "../core/stats-exporter";

export interface StatsArgs {
  taskFolder?: string;
  format: "json";
  error?: string;
}

export interface StatsResult {
  success: boolean;
  output?: string;
  error?: string;
}

export const parseStatsArgs = (args: string[]): StatsArgs => {
  let taskFolder: string | undefined;
  let format: "json" = "json";

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;

    if (arg === "--format") {
      const formatValue = args[++i];
      if (formatValue !== "json") {
        return { format: "json", error: `Unknown format: ${formatValue}` };
      }
      format = formatValue;
    } else if (arg.startsWith("--")) {
      return { format: "json", error: `Unknown option: ${arg}` };
    } else if (!taskFolder) {
      taskFolder = arg;
    }
  }

  if (!taskFolder) {
    return { format: "json", error: "Missing task folder argument" };
  }

  return { taskFolder, format };
};

export const runStatsCommand = async (
  taskFolder: string,
  devsfactoryDir?: string
): Promise<StatsResult> => {
  try {
    const stats = await exportTaskStats(taskFolder, devsfactoryDir);
    return {
      success: true,
      output: JSON.stringify(stats, null, 2)
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
};
