import type { SQLiteTaskStorage } from "../core/sqlite/sqlite-task-storage";
import { getTemplate } from "../templates";
import type { SubtaskWithContent, TaskWithContent } from "../types";

export type JobType =
  | "implementation"
  | "review"
  | "planning"
  | "completing-task"
  | "completion-review"
  | "conflict-solver";

export class ClientPromptGenerator {
  private storage: SQLiteTaskStorage;

  constructor(storage: SQLiteTaskStorage) {
    this.storage = storage;
  }

  async generate(
    jobType: JobType,
    taskFolder: string,
    subtaskFile?: string
  ): Promise<string> {
    switch (jobType) {
      case "implementation":
        return this.generateImplementation(taskFolder, subtaskFile!);
      case "review":
        return this.generateReview(taskFolder, subtaskFile!);
      case "planning":
        return this.generatePlanning(taskFolder);
      case "completing-task":
        return this.generateCompletingTask(taskFolder);
      case "completion-review":
        return this.generateCompletionReview(taskFolder);
      case "conflict-solver":
        return this.generateConflictSolver(taskFolder, subtaskFile!);
      default:
        throw new Error(`Unknown job type: ${jobType}`);
    }
  }

  private async generateImplementation(
    taskFolder: string,
    subtaskFile: string
  ): Promise<string> {
    const [task, subtask, planContent] = await Promise.all([
      this.storage.getTaskWithContent(taskFolder),
      this.storage.getSubtaskWithContent(taskFolder, subtaskFile),
      this.storage.getPlanContent(taskFolder)
    ]);

    return getTemplate("implementation", {
      taskContent: formatTaskContent(task),
      subtaskContent: formatSubtaskContent(subtask),
      planContent: formatPlanContent(planContent)
    });
  }

  private async generateReview(
    taskFolder: string,
    subtaskFile: string
  ): Promise<string> {
    const subtask = await this.storage.getSubtaskWithContent(
      taskFolder,
      subtaskFile
    );
    const reviewFilename = subtaskFile.replace(/\.md$/, "-review.md");

    return getTemplate("review", {
      subtaskContent: formatSubtaskContent(subtask),
      reviewFilename
    });
  }

  private async generatePlanning(taskFolder: string): Promise<string> {
    const task = await this.storage.getTaskWithContent(taskFolder);

    return getTemplate("planning", {
      taskContent: formatTaskContent(task)
    });
  }

  private async generateCompletingTask(taskFolder: string): Promise<string> {
    const [task, planContent] = await Promise.all([
      this.storage.getTaskWithContent(taskFolder),
      this.storage.getPlanContent(taskFolder)
    ]);

    return getTemplate("completing-task", {
      taskFolder,
      taskContent: formatTaskContent(task),
      planContent: formatPlanContent(planContent)
    });
  }

  private async generateCompletionReview(taskFolder: string): Promise<string> {
    const [task, planContent] = await Promise.all([
      this.storage.getTaskWithContent(taskFolder),
      this.storage.getPlanContent(taskFolder)
    ]);

    return getTemplate("completion-review", {
      taskFolder,
      taskContent: formatTaskContent(task),
      planContent: formatPlanContent(planContent)
    });
  }

  private async generateConflictSolver(
    taskFolder: string,
    subtaskFile: string
  ): Promise<string> {
    return getTemplate("conflict-solver", { taskFolder, subtaskFile });
  }
}

const formatTaskContent = (task: TaskWithContent | null): string => {
  if (!task) {
    return "## Task\n\n*Task not found*";
  }

  const { frontmatter, description, requirements, acceptanceCriteria } = task;
  const lines: string[] = ["## Task", ""];

  lines.push(`**Title:** ${frontmatter.title}`);
  lines.push(`**Status:** ${frontmatter.status}`);
  lines.push(`**Priority:** ${frontmatter.priority}`);

  if (frontmatter.tags?.length) {
    lines.push(`**Tags:** ${frontmatter.tags.join(", ")}`);
  }
  if (frontmatter.branch) {
    lines.push(`**Branch:** ${frontmatter.branch}`);
  }

  lines.push("", "### Description", "", description);

  if (requirements) {
    lines.push("", "### Requirements", "", requirements);
  }

  if (acceptanceCriteria?.length) {
    lines.push("", "### Acceptance Criteria", "");
    for (const criterion of acceptanceCriteria) {
      lines.push(`- [ ] ${criterion}`);
    }
  }

  return lines.join("\n");
};

const formatSubtaskContent = (subtask: SubtaskWithContent | null): string => {
  if (!subtask) {
    return "## Subtask\n\n*Subtask not found*";
  }

  const { frontmatter, objective, acceptanceCriteria, tasksChecklist, result } =
    subtask;
  const lines: string[] = ["## Subtask", ""];

  lines.push(`**Title:** ${frontmatter.title}`);
  lines.push(`**Status:** ${frontmatter.status}`);

  if (frontmatter.dependencies?.length) {
    lines.push(`**Dependencies:** ${frontmatter.dependencies.join(", ")}`);
  }

  if (objective) {
    lines.push("", "### Objective", "", objective);
  }

  if (acceptanceCriteria) {
    lines.push("", "### Acceptance Criteria", "", acceptanceCriteria);
  }

  if (tasksChecklist) {
    lines.push("", "### Tasks Checklist", "", tasksChecklist);
  }

  if (result) {
    lines.push("", "### Result", "", result);
  }

  return lines.join("\n");
};

const formatPlanContent = (content: string | null): string => {
  if (!content) {
    return "## Plan\n\n*Plan not found*";
  }

  return `## Plan\n\n${content}`;
};
