import { rm } from "node:fs/promises";
import { join } from "node:path";
import { getGlobalDir } from "../core/global-bootstrap";
import { getDatabase } from "../core/sqlite/database";
import { listProjects } from "../core/sqlite/project-store";
import { parsePlan } from "../migration/plan-parser";
import { listSubtasks } from "../migration/subtask-parser";
import { listTaskFolders, parseTask } from "../migration/task-parser";

export interface MigrateArgs {
  dryRun: boolean;
  removeFiles: boolean;
  help?: boolean;
  error?: string;
}

export interface MigrateSummary {
  tasksImported: number;
  subtasksImported: number;
  plansImported: number;
  brainstormsImported: number;
  skipped: number;
  errors: number;
}

export interface MigrateResult {
  success: boolean;
  summary?: MigrateSummary;
  failedFiles?: string[];
  hasErrors?: boolean;
  message?: string;
  error?: string;
}

export const parseMigrateArgs = (args: string[]): MigrateArgs => {
  const result: MigrateArgs = {
    dryRun: false,
    removeFiles: false
  };

  for (const arg of args) {
    if (arg === "-h" || arg === "--help") {
      return { ...result, help: true };
    }
    if (arg === "--dry-run") {
      result.dryRun = true;
    } else if (arg === "--remove-files") {
      result.removeFiles = true;
    } else if (arg.startsWith("-")) {
      return { ...result, error: `Unknown option: ${arg}` };
    }
  }

  return result;
};

export const runMigrateCommand = async (
  args: MigrateArgs
): Promise<MigrateResult> => {
  const globalDir = getGlobalDir();
  const tasksBaseDir = join(globalDir, "tasks");
  const db = getDatabase();

  const summary: MigrateSummary = {
    tasksImported: 0,
    subtasksImported: 0,
    plansImported: 0,
    brainstormsImported: 0,
    skipped: 0,
    errors: 0
  };
  const failedFiles: string[] = [];
  const filesToRemove: string[] = [];

  const projects = listProjects();

  for (const project of projects) {
    const projectTasksDir = join(tasksBaseDir, project.name);

    let taskFolders: string[] = [];
    try {
      taskFolders = await listTaskFolders(projectTasksDir);
    } catch {
      continue;
    }

    for (const taskFolder of taskFolders) {
      const taskPath = join(projectTasksDir, taskFolder, "task.md");

      const existing = db.queryOne<{ folder: string }>(
        "SELECT folder FROM tasks WHERE project_name = ? AND folder = ?",
        [project.name, taskFolder]
      );

      if (existing) {
        summary.skipped++;
        continue;
      }

      try {
        const task = await parseTask(taskFolder, projectTasksDir);

        if (!args.dryRun) {
          db.run(
            `INSERT INTO tasks (
              project_name, folder, title, status, priority, created_at,
              started_at, completed_at, duration_ms, tags, assignee,
              dependencies, branch, description, requirements, acceptance_criteria, notes
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              project.name,
              taskFolder,
              task.frontmatter.title,
              task.frontmatter.status,
              task.frontmatter.priority,
              task.frontmatter.created.toISOString(),
              task.frontmatter.startedAt?.toISOString() ?? null,
              task.frontmatter.completedAt?.toISOString() ?? null,
              task.frontmatter.durationMs,
              JSON.stringify(task.frontmatter.tags),
              task.frontmatter.assignee,
              JSON.stringify(task.frontmatter.dependencies),
              task.frontmatter.branch ?? null,
              task.description,
              task.requirements,
              JSON.stringify(task.acceptanceCriteria),
              task.notes ?? null
            ]
          );
        }
        summary.tasksImported++;
        filesToRemove.push(taskPath);

        const subtasks = await migrateSubtasks(
          project.name,
          taskFolder,
          projectTasksDir,
          args.dryRun,
          db,
          failedFiles,
          filesToRemove
        );
        summary.subtasksImported += subtasks;

        const planImported = await migratePlan(
          project.name,
          taskFolder,
          projectTasksDir,
          args.dryRun,
          db,
          failedFiles,
          filesToRemove
        );
        if (planImported) {
          summary.plansImported++;
        }
      } catch (_err) {
        summary.errors++;
        failedFiles.push(taskPath);
      }
    }
  }

  if (args.removeFiles && !args.dryRun && filesToRemove.length > 0) {
    for (const file of filesToRemove) {
      try {
        await rm(file, { force: true });
      } catch {
        // Ignore removal errors
      }
    }
  }

  return {
    success: true,
    summary,
    failedFiles: failedFiles.length > 0 ? failedFiles : undefined,
    hasErrors: summary.errors > 0
  };
};

const migrateSubtasks = async (
  projectName: string,
  taskFolder: string,
  projectTasksDir: string,
  dryRun: boolean,
  db: ReturnType<typeof getDatabase>,
  failedFiles: string[],
  filesToRemove: string[]
): Promise<number> => {
  let count = 0;

  try {
    const subtasks = await listSubtasks(taskFolder, projectTasksDir);

    for (const subtask of subtasks) {
      const subtaskPath = join(projectTasksDir, taskFolder, subtask.filename);

      try {
        if (!dryRun) {
          db.run(
            `INSERT INTO subtasks (
              project_name, task_folder, filename, number, slug, title, status,
              dependencies, description, context, objective, result, review, blockers,
              started_at, completed_at, duration_ms,
              phase_implementation_ms, phase_review_ms, phase_merge_ms, phase_conflict_solver_ms
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              projectName,
              taskFolder,
              subtask.filename,
              subtask.number,
              subtask.slug,
              subtask.frontmatter.title,
              subtask.frontmatter.status,
              JSON.stringify(subtask.frontmatter.dependencies ?? []),
              subtask.description,
              subtask.context ?? null,
              subtask.description,
              subtask.result ?? null,
              subtask.review ?? null,
              subtask.blockers ?? null,
              subtask.frontmatter.timing?.startedAt?.toISOString() ?? null,
              subtask.frontmatter.timing?.completedAt?.toISOString() ?? null,
              subtask.frontmatter.timing?.durationMs ?? null,
              subtask.frontmatter.timing?.phases?.implementation ?? null,
              subtask.frontmatter.timing?.phases?.review ?? null,
              subtask.frontmatter.timing?.phases?.merge ?? null,
              subtask.frontmatter.timing?.phases?.conflictSolver ?? null
            ]
          );
        }
        count++;
        filesToRemove.push(subtaskPath);
      } catch {
        failedFiles.push(subtaskPath);
      }
    }
  } catch {
    // listSubtasks failed, skip
  }

  return count;
};

const migratePlan = async (
  projectName: string,
  taskFolder: string,
  projectTasksDir: string,
  dryRun: boolean,
  db: ReturnType<typeof getDatabase>,
  failedFiles: string[],
  filesToRemove: string[]
): Promise<boolean> => {
  const planPath = join(projectTasksDir, taskFolder, "plan.md");

  try {
    const plan = await parsePlan(taskFolder, projectTasksDir);
    if (!plan) return false;

    if (!dryRun) {
      db.run(
        `INSERT INTO plans (project_name, task_folder, status, created_at, subtask_refs, content)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          projectName,
          taskFolder,
          plan.frontmatter.status,
          plan.frontmatter.created.toISOString(),
          JSON.stringify(plan.subtasks),
          null
        ]
      );
    }
    filesToRemove.push(planPath);
    return true;
  } catch {
    failedFiles.push(planPath);
    return false;
  }
};
