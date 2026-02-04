import { describe, expect, test } from "bun:test";
import {
  createTemplateContext,
  resolveTemplate,
  TemplateResolutionError,
  validateTemplate,
} from "./template-resolver.ts";

describe("createTemplateContext", () => {
  test("creates context with all fields", () => {
    const context = createTemplateContext({
      worktreePath: "/path/to/worktree",
      worktreeBranch: "feature-branch",
      taskId: "task-123",
      changePath: "changes/my-change",
      stepType: "implement",
      executionId: "exec-456",
    });

    expect(context.worktree.path).toBe("/path/to/worktree");
    expect(context.worktree.branch).toBe("feature-branch");
    expect(context.task.id).toBe("task-123");
    expect(context.task.changePath).toBe("changes/my-change");
    expect(context.step.type).toBe("implement");
    expect(context.step.executionId).toBe("exec-456");
  });
});

describe("resolveTemplate", () => {
  const baseContext = createTemplateContext({
    worktreePath: "/repo/.worktrees/task-1",
    worktreeBranch: "aop/task-1",
    taskId: "task-1",
    changePath: "changes/feature",
    stepType: "implement",
    executionId: "exec-1",
  });

  test("resolves worktree placeholders", () => {
    const template = "cd {{worktree.path}} && git checkout {{worktree.branch}}";
    const result = resolveTemplate(template, baseContext);

    expect(result).toBe("cd /repo/.worktrees/task-1 && git checkout aop/task-1");
  });

  test("resolves task placeholders", () => {
    const template = "Task {{task.id}} at {{task.changePath}}";
    const result = resolveTemplate(template, baseContext);

    expect(result).toBe("Task task-1 at changes/feature");
  });

  test("resolves step placeholders", () => {
    const template = "Step {{step.type}} execution {{step.executionId}}";
    const result = resolveTemplate(template, baseContext);

    expect(result).toBe("Step implement execution exec-1");
  });

  test("resolves multiple placeholders", () => {
    const template = "Run {{step.type}} for {{task.id}} in {{worktree.path}}";
    const result = resolveTemplate(template, baseContext);

    expect(result).toBe("Run implement for task-1 in /repo/.worktrees/task-1");
  });

  test("returns original string when no placeholders", () => {
    const template = "plain text without placeholders";
    const result = resolveTemplate(template, baseContext);

    expect(result).toBe("plain text without placeholders");
  });

  test("throws TemplateResolutionError on invalid syntax", () => {
    const template = "{{#if broken";

    expect(() => resolveTemplate(template, baseContext)).toThrow(TemplateResolutionError);
  });
});

describe("validateTemplate", () => {
  test("returns empty array for valid placeholders", () => {
    const template = "{{worktree.path}} {{task.id}} {{step.type}}";
    const result = validateTemplate(template);

    expect(result).toEqual([]);
  });

  test("returns unknown placeholders", () => {
    const template = "{{worktree.path}} {{unknown.field}} {{another.bad}}";
    const result = validateTemplate(template);

    expect(result).toContain("unknown.field");
    expect(result).toContain("another.bad");
    expect(result).toHaveLength(2);
  });

  test("allows all valid placeholders", () => {
    const template = `
      {{worktree.path}}
      {{worktree.branch}}
      {{task.id}}
      {{task.changePath}}
      {{step.type}}
      {{step.executionId}}
    `;
    const result = validateTemplate(template);

    expect(result).toEqual([]);
  });

  test("returns empty array for template without placeholders", () => {
    const template = "no placeholders here";
    const result = validateTemplate(template);

    expect(result).toEqual([]);
  });
});

describe("TemplateResolutionError", () => {
  test("has correct name", () => {
    const error = new TemplateResolutionError("test error");

    expect(error.name).toBe("TemplateResolutionError");
    expect(error.message).toBe("test error");
  });
});
