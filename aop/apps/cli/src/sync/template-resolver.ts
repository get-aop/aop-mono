import { getLogger } from "@aop/infra";
import Handlebars from "handlebars";

const logger = getLogger("aop", "template-resolver");

export interface WorktreeContext {
  path: string;
  branch: string;
}

export interface TaskContext {
  id: string;
  changePath: string;
}

export interface StepContext {
  type: string;
  executionId: string;
}

export interface TemplateContext {
  worktree: WorktreeContext;
  task: TaskContext;
  step: StepContext;
}

export const resolveTemplate = (template: string, context: TemplateContext): string => {
  const log = logger.with({ taskId: context.task.id, stepType: context.step.type });

  try {
    const compiled = Handlebars.compile(template, { noEscape: true });
    const resolved = compiled(context);

    log.debug("Template resolved successfully");
    return resolved;
  } catch (err) {
    log.error("Failed to resolve template: {error}", { error: String(err) });
    throw new TemplateResolutionError(`Failed to resolve template: ${err}`);
  }
};

export const validateTemplate = (template: string): string[] => {
  const placeholderPattern = /\{\{\s*([\w.]+)\s*\}\}/g;
  const validPlaceholders = new Set([
    "worktree.path",
    "worktree.branch",
    "task.id",
    "task.changePath",
    "step.type",
    "step.executionId",
  ]);

  const unknownPlaceholders: string[] = [];
  const matches = template.matchAll(placeholderPattern);

  for (const match of matches) {
    const placeholder = match[1];
    if (placeholder && !validPlaceholders.has(placeholder)) {
      unknownPlaceholders.push(placeholder);
    }
  }

  return unknownPlaceholders;
};

export class TemplateResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TemplateResolutionError";
  }
}

export const createTemplateContext = (params: {
  worktreePath: string;
  worktreeBranch: string;
  taskId: string;
  changePath: string;
  stepType: string;
  executionId: string;
}): TemplateContext => ({
  worktree: {
    path: params.worktreePath,
    branch: params.worktreeBranch,
  },
  task: {
    id: params.taskId,
    changePath: params.changePath,
  },
  step: {
    type: params.stepType,
    executionId: params.executionId,
  },
});
