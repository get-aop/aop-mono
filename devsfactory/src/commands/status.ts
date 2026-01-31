import { resolvePaths, resolvePathsForProject } from "../core/path-resolver";
import { getProject, listProjects } from "../core/project-registry";
import { listSubtasks } from "../parser/subtask";
import { listTaskFolders, parseTask } from "../parser/task";
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
  const projects = await listProjects();

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
  const project = await getProject(projectName);

  if (!project) {
    const projects = await listProjects();
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
  devsfactoryDir: string
): Promise<StatusResult> => {
  const tasks = await getProjectTasks(devsfactoryDir);

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
  devsfactoryDir: string
): Promise<ProjectTaskSummary> => {
  const taskFolders = await listTaskFolders(devsfactoryDir);

  let pending = 0;
  let inProgress = 0;
  let done = 0;

  for (const folder of taskFolders) {
    try {
      const task = await parseTask(folder, devsfactoryDir);
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
    } catch {
      // Skip tasks that can't be parsed
    }
  }

  return {
    projectName,
    tasks: taskFolders.length,
    pending,
    inProgress,
    done
  };
};

const getProjectTasks = async (
  devsfactoryDir: string
): Promise<TaskDetail[]> => {
  const taskFolders = await listTaskFolders(devsfactoryDir);
  const tasks: TaskDetail[] = [];

  for (const folder of taskFolders) {
    try {
      const task = await parseTask(folder, devsfactoryDir);
      const detail: TaskDetail = {
        folder,
        title: task.frontmatter.title,
        status: task.frontmatter.status
      };

      if (task.frontmatter.status === "INPROGRESS") {
        const subtasks = await listSubtasks(folder, devsfactoryDir);
        if (subtasks.length > 0) {
          const done = subtasks.filter(
            (s) => s.frontmatter.status === "DONE"
          ).length;
          detail.subtasksDone = done;
          detail.subtasksTotal = subtasks.length;
        }
      }

      tasks.push(detail);
    } catch {
      // Skip tasks that can't be parsed
    }
  }

  return tasks;
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
