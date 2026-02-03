import { resolvePaths, resolvePathsForProject } from "../core/path-resolver";
import { getProjectByName, listProjects } from "../core/sqlite/project-store";
import { SQLiteTaskStorage } from "../core/sqlite/sqlite-task-storage";
import type { TaskStatus } from "../types";

export interface StatusArgs {
  projectName?: string;
  help?: boolean;
  error?: string;
}

export interface StatusResult {
  success: boolean;
  output?: string;
  error?: string;
}

interface ProjectTaskSummary {
  projectName: string;
  tasks: number;
  pending: number;
  inProgress: number;
  done: number;
}

interface TaskDetail {
  folder: string;
  title: string;
  status: TaskStatus;
  subtasksDone?: number;
  subtasksTotal?: number;
}

export const parseStatusArgs = (args: string[]): StatusArgs => {
  const arg = args[0];

  if (!arg) {
    return {};
  }

  if (arg === "-h" || arg === "--help") {
    return { help: true };
  }

  if (arg.startsWith("-")) {
    return { error: `Unknown option: ${arg}` };
  }

  return { projectName: arg };
};

export const runStatusCommand = async (
  projectName?: string
): Promise<StatusResult> => {
  try {
    if (projectName) {
      return await showProjectStatus(projectName);
    }

    const paths = await resolvePaths();
    if (paths) {
      return await showProjectStatusByPaths(
        paths.projectName,
        paths.devsfactoryDir
      );
    }

    return await showAllProjectsStatus();
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
};

const showAllProjectsStatus = async (): Promise<StatusResult> => {
  const projects = listProjects();

  if (projects.length === 0) {
    return {
      success: true,
      output:
        "No projects registered. Run 'aop init' in a git repository to get started."
    };
  }

  const summaries: ProjectTaskSummary[] = [];

  for (const project of projects) {
    const paths = await resolvePathsForProject(project.name);
    if (!paths) continue;

    const summary = await getProjectTaskSummary(
      project.name,
      paths.devsfactoryDir
    );
    summaries.push(summary);
  }

  const output = formatSummaryTable(summaries);
  return { success: true, output };
};

const showProjectStatus = async (
  projectName: string
): Promise<StatusResult> => {
  const project = getProjectByName(projectName);

  if (!project) {
    const projects = listProjects();
    const projectList =
      projects.length > 0
        ? `Available projects:\n${projects.map((p) => `  - ${p.name}`).join("\n")}`
        : "No projects registered. Run 'aop init' in a git repository to get started.";

    return {
      success: false,
      error: `Project '${projectName}' not found.\n\n${projectList}`
    };
  }

  const paths = await resolvePathsForProject(projectName);
  if (!paths) {
    return {
      success: false,
      error: `Could not resolve paths for project '${projectName}'`
    };
  }

  return await showProjectStatusByPaths(projectName, paths.devsfactoryDir);
};

const showProjectStatusByPaths = async (
  projectName: string,
  _devsfactoryDir: string
): Promise<StatusResult> => {
  const tasks = await getProjectTasks(projectName);

  if (tasks.length === 0) {
    return {
      success: true,
      output: `Project: ${projectName}\n\nNo tasks found.`
    };
  }

  const output = formatTaskDetails(projectName, tasks);
  return { success: true, output };
};

const getProjectTaskSummary = async (
  projectName: string,
  _devsfactoryDir: string
): Promise<ProjectTaskSummary> => {
  const storage = new SQLiteTaskStorage({ projectName });
  const { tasks } = await storage.scan();

  let pending = 0;
  let inProgress = 0;
  let done = 0;

  for (const task of tasks) {
    const status = task.frontmatter.status;

    if (status === "PENDING" || status === "BACKLOG" || status === "DRAFT") {
      pending++;
    } else if (
      status === "INPROGRESS" ||
      status === "BLOCKED" ||
      status === "REVIEW"
    ) {
      inProgress++;
    } else if (status === "DONE") {
      done++;
    }
  }

  return {
    projectName,
    tasks: tasks.length,
    pending,
    inProgress,
    done
  };
};

const getProjectTasks = async (projectName: string): Promise<TaskDetail[]> => {
  const storage = new SQLiteTaskStorage({ projectName });
  const { tasks, subtasks } = await storage.scan();
  const result: TaskDetail[] = [];

  for (const task of tasks) {
    const detail: TaskDetail = {
      folder: task.folder,
      title: task.frontmatter.title,
      status: task.frontmatter.status
    };

    if (task.frontmatter.status === "INPROGRESS") {
      const taskSubtasks = subtasks[task.folder] ?? [];
      if (taskSubtasks.length > 0) {
        const doneCount = taskSubtasks.filter(
          (s) => s.frontmatter.status === "DONE"
        ).length;
        detail.subtasksDone = doneCount;
        detail.subtasksTotal = taskSubtasks.length;
      }
    }

    result.push(detail);
  }

  return result;
};

const formatSummaryTable = (summaries: ProjectTaskSummary[]): string => {
  const headers = ["PROJECT", "TASKS", "PENDING", "INPROGRESS", "DONE"];
  const rows = summaries.map((s) => [
    s.projectName,
    String(s.tasks),
    String(s.pending),
    String(s.inProgress),
    String(s.done)
  ]);

  const colWidths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => r[i]!.length))
  );

  const formatRow = (cells: string[]): string =>
    cells.map((cell, i) => cell.padEnd(colWidths[i]!)).join("  ");

  const lines = [formatRow(headers), ...rows.map(formatRow)];

  const totalTasks = summaries.reduce((sum, s) => sum + s.tasks, 0);
  const projectWord = summaries.length === 1 ? "project" : "projects";

  lines.push("");
  lines.push(
    `Total: ${totalTasks} tasks across ${summaries.length} ${projectWord}`
  );

  return lines.join("\n");
};

const formatTaskDetails = (
  projectName: string,
  tasks: TaskDetail[]
): string => {
  const lines: string[] = [];

  lines.push(`Project: ${projectName}`);
  lines.push("");

  const headers = ["TASK", "STATUS", "PROGRESS"];
  const rows = tasks.map((t) => {
    const progress =
      t.subtasksDone !== undefined && t.subtasksTotal !== undefined
        ? `${t.subtasksDone}/${t.subtasksTotal}`
        : "-";
    return [t.folder, t.status, progress];
  });

  const colWidths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => r[i]!.length))
  );

  const formatRow = (cells: string[]): string =>
    cells.map((cell, i) => cell.padEnd(colWidths[i]!)).join("  ");

  lines.push(formatRow(headers));
  lines.push(...rows.map(formatRow));

  return lines.join("\n");
};
