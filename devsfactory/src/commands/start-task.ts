import { resolvePaths, resolvePathsForProject } from "../core/path-resolver";
import { SQLiteTaskStorage } from "../core/sqlite/sqlite-task-storage";
import type { TaskStatus } from "../types";

export interface StartTaskArgs {
  help?: boolean;
  projectName?: string;
  taskFolder?: string;
  taskId?: number;
  error?: string;
}

export const parseStartTaskArgs = (args: string[]): StartTaskArgs => {
  let taskFolder: string | undefined;
  let projectName: string | undefined;
  let taskId: number | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;

    if (arg === "-h" || arg === "--help") {
      return { help: true };
    }

    if (arg === "-p" || arg === "--project") {
      const nextArg = args[i + 1];
      if (!nextArg || nextArg.startsWith("-")) {
        return { error: "--project requires a value" };
      }
      projectName = nextArg;
      i++;
      continue;
    }

    if (arg === "-i" || arg === "--task-id") {
      const nextArg = args[i + 1];
      if (!nextArg || nextArg.startsWith("-")) {
        return { error: "--task-id requires a value" };
      }
      const parsed = Number(nextArg);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        return { error: "--task-id must be a positive integer" };
      }
      taskId = parsed;
      i++;
      continue;
    }

    if (arg.startsWith("-")) {
      return { error: `Unknown option: ${arg}` };
    }

    if (!taskFolder) {
      taskFolder = arg;
    }
  }

  if (taskFolder && taskId) {
    return { error: "Provide either a task folder or --task-id, not both" };
  }

  return { taskFolder, projectName, taskId };
};

export const showStartTaskHelp = (): void => {
  console.log(`
aop start-task - Move a task to PENDING

USAGE:
  aop start-task <task-folder> [--project <name>]
  aop start-task --task-id <id> [--project <name>]

OPTIONS:
  -h, --help              Show this help message
  -p, --project <name>    Project name (optional if run inside project)
  -i, --task-id <id>      Task id from SQLite

EXAMPLES:
  aop start-task 20260125100000-add-auth
  aop start-task --task-id 42
  aop start-task 20260125100000-add-auth --project my-project
  aop start-task --task-id 42 --project my-project
`);
};

export const runStartTaskCommand = async (
  args: StartTaskArgs
): Promise<{ success: boolean; error?: string }> => {
  if (!args.taskFolder && !args.taskId) {
    return { success: false, error: "Task folder or --task-id is required" };
  }

  const paths = args.projectName
    ? await resolvePathsForProject(args.projectName)
    : await resolvePaths();

  if (!paths) {
    const errorMsg = args.projectName
      ? `Project '${args.projectName}' not found. Run 'aop projects' to see registered projects.`
      : "Not in a project context. Either:\n" +
        "  - Run from a registered project directory\n" +
        "  - Specify a project: aop start-task <task-folder> -p <project>";
    return { success: false, error: errorMsg };
  }

  const storage = new SQLiteTaskStorage({ projectName: paths.projectName });
  if (args.taskId) {
    const folder = await storage.getTaskFolderById(args.taskId);
    if (!folder) {
      return {
        success: false,
        error: `Task id ${args.taskId} not found in project '${paths.projectName}'.`
      };
    }
    await storage.updateTaskStatusById(args.taskId, "PENDING" as TaskStatus);
  } else {
    await storage.updateTaskStatus(args.taskFolder!, "PENDING" as TaskStatus);
  }
  return { success: true };
};

export const startTaskCommand = async (args: string[]): Promise<void> => {
  const parsed = parseStartTaskArgs(args);

  if (parsed.help) {
    showStartTaskHelp();
    return;
  }

  if (parsed.error) {
    console.error(`Error: ${parsed.error}`);
    process.exit(1);
  }

  const result = await runStartTaskCommand(parsed);
  if (!result.success) {
    console.error(`Error: ${result.error}`);
    process.exit(1);
  }

  console.log("Task moved to PENDING.");
};
