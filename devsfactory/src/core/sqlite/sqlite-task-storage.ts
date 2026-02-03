import type { SQLQueryBindings } from "bun:sqlite";
import { EventEmitter } from "node:events";
import type {
  PhaseTimings,
  Plan,
  Subtask,
  SubtaskContentUpdate,
  SubtaskStatus,
  SubtaskWithContent,
  Task,
  TaskContentUpdate,
  TaskStatus,
  TaskWithContent
} from "../../types";
import type {
  ScanResult,
  SubtaskInput,
  SubtaskTimingUpdate,
  TaskStorageEmitter,
  TimingUpdate
} from "../interfaces/task-storage";
import { type AopDatabase, getDatabase } from "./database";

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

interface TaskIdRow {
  id: number;
}

interface TaskFolderRow {
  folder: string;
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
  objective: string | null;
  acceptance_criteria: string | null;
  tasks_checklist: string | null;
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
  content: string | null;
}

const rowToTask = (row: TaskRow): Task => ({
  folder: row.folder,
  frontmatter: {
    title: row.title,
    status: row.status as TaskStatus,
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
    status: row.status as SubtaskStatus,
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
    status: row.status as "INPROGRESS" | "AGENT_REVIEW" | "BLOCKED" | "REVIEW",
    task: row.task_folder,
    created: new Date(row.created_at)
  },
  subtasks: JSON.parse(row.subtask_refs)
});

const generateSubtaskFilename = (number: number, title: string): string => {
  const padded = String(number).padStart(3, "0");
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
  return `${padded}-${slug}.md`;
};

export interface SQLiteTaskStorageOptions {
  projectName: string;
  pollMs?: number;
  db?: AopDatabase;
}

export class SQLiteTaskStorage
  extends EventEmitter
  implements TaskStorageEmitter
{
  private db: AopDatabase;
  private projectName: string;
  private pollInterval: Timer | null = null;
  private pollMs: number;
  private lastScanHash = "";

  constructor(options: SQLiteTaskStorageOptions) {
    super();
    this.db = options.db ?? getDatabase();
    this.projectName = options.projectName;
    this.pollMs = options.pollMs ?? 500;
  }

  async scan(): Promise<ScanResult> {
    const tasks = await this.getAllTasks();
    const plans: Record<string, Plan> = {};
    const subtasks: Record<string, Subtask[]> = {};

    for (const task of tasks) {
      const plan = await this.getPlan(task.folder);
      if (plan) plans[task.folder] = plan;

      const taskSubtasks = await this.listSubtasks(task.folder);
      if (taskSubtasks.length > 0) subtasks[task.folder] = taskSubtasks;
    }

    return { tasks, plans, subtasks };
  }

  async listTaskFolders(): Promise<string[]> {
    const rows = this.db.query<{ folder: string }>(
      "SELECT folder FROM tasks WHERE project_name = ? ORDER BY created_at DESC",
      [this.projectName]
    );
    return rows.map((r) => r.folder);
  }

  async getTask(taskFolder: string): Promise<Task | null> {
    const row = this.db.queryOne<TaskRow>(
      "SELECT * FROM tasks WHERE project_name = ? AND folder = ?",
      [this.projectName, taskFolder]
    );
    return row ? rowToTask(row) : null;
  }

  async getTaskId(taskFolder: string): Promise<number | null> {
    const row = this.db.queryOne<TaskIdRow>(
      "SELECT rowid as id FROM tasks WHERE project_name = ? AND folder = ?",
      [this.projectName, taskFolder]
    );
    return row?.id ?? null;
  }

  async getTaskFolderById(taskId: number): Promise<string | null> {
    const row = this.db.queryOne<TaskFolderRow>(
      "SELECT folder FROM tasks WHERE project_name = ? AND rowid = ?",
      [this.projectName, taskId]
    );
    return row?.folder ?? null;
  }

  async getLatestTaskRef(): Promise<{ id: number; folder: string } | null> {
    const row = this.db.queryOne<{ id: number; folder: string }>(
      "SELECT rowid as id, folder FROM tasks WHERE project_name = ? ORDER BY created_at DESC LIMIT 1",
      [this.projectName]
    );
    return row ?? null;
  }

  async getPlan(taskFolder: string): Promise<Plan | null> {
    const row = this.db.queryOne<PlanRow>(
      "SELECT * FROM plans WHERE project_name = ? AND task_folder = ?",
      [this.projectName, taskFolder]
    );
    return row ? rowToPlan(row) : null;
  }

  async listSubtasks(taskFolder: string): Promise<Subtask[]> {
    const rows = this.db.query<SubtaskRow>(
      "SELECT * FROM subtasks WHERE project_name = ? AND task_folder = ? ORDER BY number",
      [this.projectName, taskFolder]
    );
    return rows.map(rowToSubtask);
  }

  async getSubtask(
    taskFolder: string,
    filename: string
  ): Promise<Subtask | null> {
    const row = this.db.queryOne<SubtaskRow>(
      "SELECT * FROM subtasks WHERE project_name = ? AND task_folder = ? AND filename = ?",
      [this.projectName, taskFolder, filename]
    );
    return row ? rowToSubtask(row) : null;
  }

  async getReadySubtasks(taskFolder: string): Promise<Subtask[]> {
    const all = await this.listSubtasks(taskFolder);
    const doneNumbers = new Set(
      all.filter((s) => s.frontmatter.status === "DONE").map((s) => s.number)
    );

    return all.filter(
      (s) =>
        s.frontmatter.status === "PENDING" &&
        s.frontmatter.dependencies.every((d) => doneNumbers.has(d))
    );
  }

  async createTask(
    taskFolder: string,
    task: Omit<Task, "folder">
  ): Promise<void> {
    this.db.run(
      `INSERT INTO tasks (
        project_name, folder, title, status, priority, created_at,
        started_at, completed_at, duration_ms, tags, assignee,
        dependencies, branch, description, requirements, acceptance_criteria, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        this.projectName,
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
    this.emit("taskChanged", { taskFolder });
  }

  async updateTaskStatus(
    taskFolder: string,
    status: TaskStatus
  ): Promise<void> {
    this.db.run(
      "UPDATE tasks SET status = ? WHERE project_name = ? AND folder = ?",
      [status, this.projectName, taskFolder]
    );
    this.emit("taskChanged", { taskFolder });
  }

  async updateTaskStatusById(
    taskId: number,
    status: TaskStatus
  ): Promise<void> {
    const folderRow = this.db.queryOne<TaskFolderRow>(
      "SELECT folder FROM tasks WHERE project_name = ? AND rowid = ?",
      [this.projectName, taskId]
    );
    if (!folderRow) return;

    this.db.run(
      "UPDATE tasks SET status = ? WHERE project_name = ? AND rowid = ?",
      [status, this.projectName, taskId]
    );
    this.emit("taskChanged", { taskFolder: folderRow.folder });
  }

  async updateTaskTiming(
    taskFolder: string,
    timing: TimingUpdate
  ): Promise<void> {
    const setClauses: string[] = [];
    const params: SQLQueryBindings[] = [];

    if (timing.startedAt !== undefined) {
      setClauses.push("started_at = ?");
      params.push(timing.startedAt?.toISOString() ?? null);
    }
    if (timing.completedAt !== undefined) {
      setClauses.push("completed_at = ?");
      params.push(timing.completedAt?.toISOString() ?? null);
    }
    if (timing.durationMs !== undefined) {
      setClauses.push("duration_ms = ?");
      params.push(timing.durationMs);
    }

    if (setClauses.length > 0) {
      params.push(this.projectName, taskFolder);
      this.db.run(
        `UPDATE tasks SET ${setClauses.join(", ")} WHERE project_name = ? AND folder = ?`,
        params
      );
      this.emit("taskChanged", { taskFolder });
    }
  }

  async createSubtask(
    taskFolder: string,
    subtask: SubtaskInput
  ): Promise<string> {
    const existingSubtasks = await this.listSubtasks(taskFolder);
    const nextNumber =
      existingSubtasks.length > 0
        ? Math.max(...existingSubtasks.map((s) => s.number)) + 1
        : 1;

    const filename = generateSubtaskFilename(
      nextNumber,
      subtask.frontmatter.title
    );
    const slug = filename.replace(/^\d+-/, "").replace(/\.md$/, "");

    this.db.run(
      `INSERT INTO subtasks (
        project_name, task_folder, filename, number, slug, title, status,
        dependencies, description, context
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        this.projectName,
        taskFolder,
        filename,
        nextNumber,
        slug,
        subtask.frontmatter.title,
        subtask.frontmatter.status,
        JSON.stringify(subtask.frontmatter.dependencies ?? []),
        subtask.description,
        subtask.context ?? null
      ]
    );

    this.emit("subtaskChanged", { taskFolder, filename });
    return filename;
  }

  async updateSubtaskStatus(
    taskFolder: string,
    filename: string,
    status: SubtaskStatus
  ): Promise<void> {
    this.db.run(
      "UPDATE subtasks SET status = ? WHERE project_name = ? AND task_folder = ? AND filename = ?",
      [status, this.projectName, taskFolder, filename]
    );
    this.emit("subtaskChanged", { taskFolder, filename });
  }

  async updateSubtaskTiming(
    taskFolder: string,
    filename: string,
    timing: SubtaskTimingUpdate
  ): Promise<void> {
    const setClauses: string[] = [];
    const params: SQLQueryBindings[] = [];

    if (timing.startedAt !== undefined) {
      setClauses.push("started_at = ?");
      params.push(timing.startedAt?.toISOString() ?? null);
    }
    if (timing.completedAt !== undefined) {
      setClauses.push("completed_at = ?");
      params.push(timing.completedAt?.toISOString() ?? null);
    }
    if (timing.durationMs !== undefined) {
      setClauses.push("duration_ms = ?");
      params.push(timing.durationMs);
    }
    if (timing.phases) {
      if (timing.phases.implementation !== undefined) {
        setClauses.push("phase_implementation_ms = ?");
        params.push(timing.phases.implementation);
      }
      if (timing.phases.review !== undefined) {
        setClauses.push("phase_review_ms = ?");
        params.push(timing.phases.review);
      }
      if (timing.phases.merge !== undefined) {
        setClauses.push("phase_merge_ms = ?");
        params.push(timing.phases.merge);
      }
      if (timing.phases.conflictSolver !== undefined) {
        setClauses.push("phase_conflict_solver_ms = ?");
        params.push(timing.phases.conflictSolver);
      }
    }

    if (setClauses.length > 0) {
      params.push(this.projectName, taskFolder, filename);
      this.db.run(
        `UPDATE subtasks SET ${setClauses.join(", ")}
         WHERE project_name = ? AND task_folder = ? AND filename = ?`,
        params
      );
      this.emit("subtaskChanged", { taskFolder, filename });
    }
  }

  async recordPhaseDuration(
    taskFolder: string,
    filename: string,
    phase: keyof PhaseTimings,
    durationMs: number
  ): Promise<void> {
    const columnMap: Record<keyof PhaseTimings, string> = {
      implementation: "phase_implementation_ms",
      review: "phase_review_ms",
      merge: "phase_merge_ms",
      conflictSolver: "phase_conflict_solver_ms"
    };

    const column = columnMap[phase];
    this.db.run(
      `UPDATE subtasks SET ${column} = ?
       WHERE project_name = ? AND task_folder = ? AND filename = ?`,
      [durationMs, this.projectName, taskFolder, filename]
    );
    this.emit("subtaskChanged", { taskFolder, filename });
  }

  async appendReviewHistory(
    taskFolder: string,
    subtaskFilename: string,
    content: string
  ): Promise<void> {
    const subtask = await this.getSubtask(taskFolder, subtaskFilename);
    if (!subtask) {
      throw new Error(`Subtask '${subtaskFilename}' not found`);
    }

    const existingReview = subtask.review ?? "";
    const newReview = existingReview
      ? `${existingReview}\n\n---\n\n${content}`
      : content;

    this.db.run(
      "UPDATE subtasks SET review = ? WHERE project_name = ? AND task_folder = ? AND filename = ?",
      [newReview, this.projectName, taskFolder, subtaskFilename]
    );
    this.emit("reviewChanged", { taskFolder });
  }

  async start(): Promise<void> {
    this.lastScanHash = await this.computeScanHash();
    this.pollInterval = setInterval(() => {
      this.poll().catch((err) => {
        this.emit("error", err);
      });
    }, this.pollMs);
  }

  async stop(): Promise<void> {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  isWatching(): boolean {
    return this.pollInterval !== null;
  }

  // Internal helpers

  private async getAllTasks(): Promise<Task[]> {
    const rows = this.db.query<TaskRow>(
      "SELECT * FROM tasks WHERE project_name = ? ORDER BY created_at DESC",
      [this.projectName]
    );
    return rows.map(rowToTask);
  }

  private async computeScanHash(): Promise<string> {
    const tasks = this.db.query<{ folder: string; status: string }>(
      "SELECT folder, status FROM tasks WHERE project_name = ?",
      [this.projectName]
    );
    const subtasks = this.db.query<{
      task_folder: string;
      filename: string;
      status: string;
    }>(
      "SELECT task_folder, filename, status FROM subtasks WHERE project_name = ?",
      [this.projectName]
    );
    return JSON.stringify({ tasks, subtasks });
  }

  private async poll(): Promise<void> {
    const currentHash = await this.computeScanHash();
    if (currentHash !== this.lastScanHash) {
      this.lastScanHash = currentHash;
      this.emit("taskChanged", { taskFolder: "*" });
    }
  }

  // Plan operations

  async createPlan(
    taskFolder: string,
    plan: Omit<Plan, "folder">
  ): Promise<void> {
    this.db.run(
      `INSERT INTO plans (project_name, task_folder, status, created_at, subtask_refs)
       VALUES (?, ?, ?, ?, ?)`,
      [
        this.projectName,
        taskFolder,
        plan.frontmatter.status,
        plan.frontmatter.created.toISOString(),
        JSON.stringify(plan.subtasks)
      ]
    );
    this.emit("planChanged", { taskFolder });
  }

  async updatePlanStatus(
    taskFolder: string,
    status: Plan["frontmatter"]["status"]
  ): Promise<void> {
    this.db.run(
      "UPDATE plans SET status = ? WHERE project_name = ? AND task_folder = ?",
      [status, this.projectName, taskFolder]
    );
    this.emit("planChanged", { taskFolder });
  }

  // Content read/write methods

  async getTaskWithContent(
    taskFolder: string
  ): Promise<TaskWithContent | null> {
    const row = this.db.queryOne<TaskRow>(
      "SELECT * FROM tasks WHERE project_name = ? AND folder = ?",
      [this.projectName, taskFolder]
    );
    if (!row) return null;

    const rawCriteria = row.acceptance_criteria
      ? JSON.parse(row.acceptance_criteria)
      : [];
    const acceptanceCriteria = rawCriteria.map(
      (c: { text: string } | string) => (typeof c === "string" ? c : c.text)
    );

    return {
      folder: row.folder,
      frontmatter: {
        title: row.title,
        status: row.status as TaskStatus,
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
      requirements: row.requirements || undefined,
      acceptanceCriteria,
      notes: row.notes || undefined
    };
  }

  async getSubtaskWithContent(
    taskFolder: string,
    filename: string
  ): Promise<SubtaskWithContent | null> {
    const row = this.db.queryOne<SubtaskRow>(
      "SELECT * FROM subtasks WHERE project_name = ? AND task_folder = ? AND filename = ?",
      [this.projectName, taskFolder, filename]
    );
    if (!row) return null;

    return {
      filename: row.filename,
      frontmatter: {
        title: row.title,
        status: row.status as SubtaskStatus,
        dependencies: row.dependencies ? JSON.parse(row.dependencies) : []
      },
      objective: row.objective || "",
      acceptanceCriteria: row.acceptance_criteria || undefined,
      tasksChecklist: row.tasks_checklist || undefined,
      result: row.result || undefined
    };
  }

  async getPlanContent(taskFolder: string): Promise<string | null> {
    const row = this.db.queryOne<PlanRow>(
      "SELECT content FROM plans WHERE project_name = ? AND task_folder = ?",
      [this.projectName, taskFolder]
    );
    return row?.content ?? null;
  }

  async createTaskWithContent(data: TaskWithContent): Promise<void> {
    this.db.run(
      `INSERT INTO tasks (
        project_name, folder, title, status, priority, created_at,
        started_at, completed_at, duration_ms, tags, assignee,
        dependencies, branch, description, requirements, acceptance_criteria, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        this.projectName,
        data.folder,
        data.frontmatter.title,
        data.frontmatter.status,
        data.frontmatter.priority,
        data.frontmatter.created.toISOString(),
        data.frontmatter.startedAt?.toISOString() ?? null,
        data.frontmatter.completedAt?.toISOString() ?? null,
        data.frontmatter.durationMs,
        JSON.stringify(data.frontmatter.tags),
        data.frontmatter.assignee,
        JSON.stringify(data.frontmatter.dependencies),
        data.frontmatter.branch ?? null,
        data.description,
        data.requirements ?? "",
        JSON.stringify(data.acceptanceCriteria ?? []),
        data.notes ?? null
      ]
    );
    this.emit("taskChanged", { taskFolder: data.folder });
  }

  async createSubtaskWithContent(
    taskFolder: string,
    data: SubtaskWithContent
  ): Promise<string> {
    const existingSubtasks = await this.listSubtasks(taskFolder);
    const nextNumber =
      existingSubtasks.length > 0
        ? Math.max(...existingSubtasks.map((s) => s.number)) + 1
        : 1;

    const filename =
      data.filename ||
      generateSubtaskFilename(nextNumber, data.frontmatter.title);
    const slug = filename.replace(/^\d+-/, "").replace(/\.md$/, "");

    this.db.run(
      `INSERT INTO subtasks (
        project_name, task_folder, filename, number, slug, title, status,
        dependencies, description, objective, acceptance_criteria, tasks_checklist, result
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        this.projectName,
        taskFolder,
        filename,
        nextNumber,
        slug,
        data.frontmatter.title,
        data.frontmatter.status,
        JSON.stringify(data.frontmatter.dependencies ?? []),
        data.objective || "",
        data.objective || "",
        data.acceptanceCriteria ?? null,
        data.tasksChecklist ?? null,
        data.result ?? null
      ]
    );

    this.emit("subtaskChanged", { taskFolder, filename });
    return filename;
  }

  async updateTaskContent(
    taskFolder: string,
    content: TaskContentUpdate
  ): Promise<void> {
    const setClauses: string[] = [];
    const params: SQLQueryBindings[] = [];

    if (content.description !== undefined) {
      setClauses.push("description = ?");
      params.push(content.description);
    }
    if (content.requirements !== undefined) {
      setClauses.push("requirements = ?");
      params.push(content.requirements);
    }
    if (content.acceptanceCriteria !== undefined) {
      setClauses.push("acceptance_criteria = ?");
      params.push(JSON.stringify(content.acceptanceCriteria));
    }
    if (content.notes !== undefined) {
      setClauses.push("notes = ?");
      params.push(content.notes);
    }

    if (setClauses.length > 0) {
      params.push(this.projectName, taskFolder);
      this.db.run(
        `UPDATE tasks SET ${setClauses.join(", ")} WHERE project_name = ? AND folder = ?`,
        params
      );
      this.emit("taskChanged", { taskFolder });
    }
  }

  async updateSubtaskContent(
    taskFolder: string,
    filename: string,
    content: SubtaskContentUpdate
  ): Promise<void> {
    const setClauses: string[] = [];
    const params: SQLQueryBindings[] = [];

    if (content.objective !== undefined) {
      setClauses.push("objective = ?");
      params.push(content.objective);
    }
    if (content.acceptanceCriteria !== undefined) {
      setClauses.push("acceptance_criteria = ?");
      params.push(content.acceptanceCriteria);
    }
    if (content.tasksChecklist !== undefined) {
      setClauses.push("tasks_checklist = ?");
      params.push(content.tasksChecklist);
    }
    if (content.result !== undefined) {
      setClauses.push("result = ?");
      params.push(content.result);
    }

    if (setClauses.length > 0) {
      params.push(this.projectName, taskFolder, filename);
      this.db.run(
        `UPDATE subtasks SET ${setClauses.join(", ")}
         WHERE project_name = ? AND task_folder = ? AND filename = ?`,
        params
      );
      this.emit("subtaskChanged", { taskFolder, filename });
    }
  }

  async updatePlanContent(taskFolder: string, content: string): Promise<void> {
    this.db.run(
      "UPDATE plans SET content = ? WHERE project_name = ? AND task_folder = ?",
      [content, this.projectName, taskFolder]
    );
    this.emit("planChanged", { taskFolder });
  }
}
