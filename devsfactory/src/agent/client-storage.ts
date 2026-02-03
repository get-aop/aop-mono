import { type AopDatabase, getDatabase } from "../core/sqlite/database";
import type { Plan, Subtask, Task } from "../types";

interface TaskRow {
  project_name: string;
  folder: string;
  title: string;
  status: string;
  priority: string;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  duration_ms: number | null;
  tags: string | null;
  assignee: string | null;
  dependencies: string | null;
  branch: string | null;
  description: string;
  requirements: string;
  acceptance_criteria: string;
  notes: string | null;
}

interface SubtaskRow {
  project_name: string;
  task_folder: string;
  filename: string;
  number: number;
  slug: string;
  title: string;
  status: string;
  dependencies: string | null;
  description: string;
  context: string | null;
  result: string | null;
  review: string | null;
  blockers: string | null;
  started_at: string | null;
  completed_at: string | null;
  duration_ms: number | null;
  phase_implementation_ms: number | null;
  phase_review_ms: number | null;
  phase_merge_ms: number | null;
  phase_conflict_solver_ms: number | null;
}

interface PlanRow {
  project_name: string;
  task_folder: string;
  status: string;
  created_at: string;
  subtask_refs: string;
}

const rowToTask = (row: TaskRow): Task => ({
  folder: row.folder,
  frontmatter: {
    title: row.title,
    status: row.status as Task["frontmatter"]["status"],
    created: new Date(row.created_at),
    priority: row.priority as "high" | "medium" | "low",
    tags: row.tags ? JSON.parse(row.tags) : [],
    assignee: row.assignee,
    dependencies: row.dependencies ? JSON.parse(row.dependencies) : [],
    branch: row.branch ?? undefined,
    startedAt: row.started_at ? new Date(row.started_at) : null,
    completedAt: row.completed_at ? new Date(row.completed_at) : null,
    durationMs: row.duration_ms
  },
  description: row.description,
  requirements: row.requirements,
  acceptanceCriteria: row.acceptance_criteria
    ? JSON.parse(row.acceptance_criteria)
    : [],
  notes: row.notes ?? undefined
});

const rowToSubtask = (row: SubtaskRow): Subtask => ({
  filename: row.filename,
  number: row.number,
  slug: row.slug,
  frontmatter: {
    title: row.title,
    status: row.status as Subtask["frontmatter"]["status"],
    dependencies: row.dependencies ? JSON.parse(row.dependencies) : [],
    timing: {
      startedAt: row.started_at ? new Date(row.started_at) : null,
      completedAt: row.completed_at ? new Date(row.completed_at) : null,
      durationMs: row.duration_ms,
      phases: {
        implementation: row.phase_implementation_ms,
        review: row.phase_review_ms,
        merge: row.phase_merge_ms,
        conflictSolver: row.phase_conflict_solver_ms
      }
    }
  },
  description: row.description,
  context: row.context ?? undefined,
  result: row.result ?? undefined,
  review: row.review ?? undefined,
  blockers: row.blockers ?? undefined
});

const rowToPlan = (row: PlanRow): Plan => ({
  folder: row.task_folder,
  frontmatter: {
    status: row.status as Plan["frontmatter"]["status"],
    task: row.task_folder,
    created: new Date(row.created_at)
  },
  subtasks: JSON.parse(row.subtask_refs)
});

/**
 * Client-side storage for reading task data from the shared SQLite database.
 * Used by agents in v2 protocol to generate prompts locally instead of
 * receiving them from the server.
 */
export class ClientStorage {
  private db: AopDatabase;
  private projectName: string;

  constructor(projectName: string, db?: AopDatabase) {
    this.db = db ?? getDatabase();
    this.projectName = projectName;
  }

  getTask(taskFolder: string): Task | null {
    const row = this.db.queryOne<TaskRow>(
      "SELECT * FROM tasks WHERE project_name = ? AND folder = ?",
      [this.projectName, taskFolder]
    );
    return row ? rowToTask(row) : null;
  }

  getSubtask(taskFolder: string, filename: string): Subtask | null {
    const row = this.db.queryOne<SubtaskRow>(
      "SELECT * FROM subtasks WHERE project_name = ? AND task_folder = ? AND filename = ?",
      [this.projectName, taskFolder, filename]
    );
    return row ? rowToSubtask(row) : null;
  }

  getPlan(taskFolder: string): Plan | null {
    const row = this.db.queryOne<PlanRow>(
      "SELECT * FROM plans WHERE project_name = ? AND task_folder = ?",
      [this.projectName, taskFolder]
    );
    return row ? rowToPlan(row) : null;
  }

  listSubtasks(taskFolder: string): Subtask[] {
    const rows = this.db.query<SubtaskRow>(
      "SELECT * FROM subtasks WHERE project_name = ? AND task_folder = ? ORDER BY number",
      [this.projectName, taskFolder]
    );
    return rows.map(rowToSubtask);
  }

  listTasks(): Task[] {
    const rows = this.db.query<TaskRow>(
      "SELECT * FROM tasks WHERE project_name = ? ORDER BY created_at DESC",
      [this.projectName]
    );
    return rows.map(rowToTask);
  }

  getReadySubtasks(taskFolder: string): Subtask[] {
    const all = this.listSubtasks(taskFolder);
    const doneNumbers = new Set(
      all.filter((s) => s.frontmatter.status === "DONE").map((s) => s.number)
    );

    return all.filter(
      (s) =>
        s.frontmatter.status === "PENDING" &&
        s.frontmatter.dependencies.every((d) => doneNumbers.has(d))
    );
  }
}
