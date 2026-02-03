import { describe, expect, test } from "bun:test";
import {
  createTemplateContext,
  resolveTemplate,
  type TemplateContext,
  TemplateResolutionError,
  validateTemplate,
} from "./template-resolver.ts";

const createTestContext = (overrides?: Partial<TemplateContext>): TemplateContext => ({
  worktree: {
    path: "/home/user/repo/.worktrees/task_123",
    branch: "task_123",
    ...overrides?.worktree,
  },
  task: {
    id: "task_123",
    changePath: "/home/user/repo/openspec/changes/my-feature",
    ...overrides?.task,
  },
  step: {
    type: "implement",
    executionId: "exec_456",
    ...overrides?.step,
  },
});

describe("resolveTemplate", () => {
  test("resolves worktree.path placeholder", () => {
    const template = "Worktree path: {{worktree.path}}";
    const context = createTestContext();

    const result = resolveTemplate(template, context);

    expect(result).toBe("Worktree path: /home/user/repo/.worktrees/task_123");
  });

  test("resolves worktree.branch placeholder", () => {
    const template = "Branch: {{worktree.branch}}";
    const context = createTestContext();

    const result = resolveTemplate(template, context);

    expect(result).toBe("Branch: task_123");
  });

  test("resolves task.id placeholder", () => {
    const template = "Task ID: {{task.id}}";
    const context = createTestContext();

    const result = resolveTemplate(template, context);

    expect(result).toBe("Task ID: task_123");
  });

  test("resolves task.changePath placeholder", () => {
    const template = "Change path: {{task.changePath}}";
    const context = createTestContext();

    const result = resolveTemplate(template, context);

    expect(result).toBe("Change path: /home/user/repo/openspec/changes/my-feature");
  });

  test("resolves step.type placeholder", () => {
    const template = "Step type: {{step.type}}";
    const context = createTestContext();

    const result = resolveTemplate(template, context);

    expect(result).toBe("Step type: implement");
  });

  test("resolves step.executionId placeholder", () => {
    const template = "Execution: {{step.executionId}}";
    const context = createTestContext();

    const result = resolveTemplate(template, context);

    expect(result).toBe("Execution: exec_456");
  });

  test("resolves multiple placeholders in one template", () => {
    const template = `## Worktree Information
- **Path**: {{worktree.path}}
- **Branch**: {{worktree.branch}}

## Task Details
- **Task ID**: {{task.id}}
- **Change Path**: {{task.changePath}}

## Execution Context
- **Step Type**: {{step.type}}
- **Execution ID**: {{step.executionId}}`;

    const context = createTestContext();
    const result = resolveTemplate(template, context);

    expect(result).toContain("- **Path**: /home/user/repo/.worktrees/task_123");
    expect(result).toContain("- **Branch**: task_123");
    expect(result).toContain("- **Task ID**: task_123");
    expect(result).toContain("- **Change Path**: /home/user/repo/openspec/changes/my-feature");
    expect(result).toContain("- **Step Type**: implement");
    expect(result).toContain("- **Execution ID**: exec_456");
  });

  test("handles template without placeholders", () => {
    const template = "This is a static template with no variables.";
    const context = createTestContext();

    const result = resolveTemplate(template, context);

    expect(result).toBe("This is a static template with no variables.");
  });

  test("preserves special characters in resolved values", () => {
    const context = createTestContext({
      worktree: {
        path: "/path/with spaces/and-dashes/under_scores",
        branch: "feature/my-branch",
      },
    });
    const template = "Path: {{worktree.path}}, Branch: {{worktree.branch}}";

    const result = resolveTemplate(template, context);

    expect(result).toBe(
      "Path: /path/with spaces/and-dashes/under_scores, Branch: feature/my-branch",
    );
  });

  test("does not escape HTML in resolved values (noEscape mode)", () => {
    const context = createTestContext({
      task: {
        id: "task_123",
        changePath: "/path/with<special>chars&more",
      },
    });
    const template = "Path: {{task.changePath}}";

    const result = resolveTemplate(template, context);

    expect(result).toBe("Path: /path/with<special>chars&more");
  });
});

describe("validateTemplate", () => {
  test("returns empty array for valid placeholders", () => {
    const template = "{{worktree.path}} {{task.id}} {{step.type}}";

    const result = validateTemplate(template);

    expect(result).toEqual([]);
  });

  test("detects unknown placeholders", () => {
    const template = "{{worktree.path}} {{unknown.field}} {{another.invalid}}";

    const result = validateTemplate(template);

    expect(result).toContain("unknown.field");
    expect(result).toContain("another.invalid");
    expect(result).not.toContain("worktree.path");
  });

  test("validates all known placeholders", () => {
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

  test("handles template with no placeholders", () => {
    const template = "No placeholders here";

    const result = validateTemplate(template);

    expect(result).toEqual([]);
  });

  test("handles placeholders with extra whitespace", () => {
    const template = "{{ worktree.path }} {{  task.id  }}";

    const result = validateTemplate(template);

    expect(result).toEqual([]);
  });
});

describe("createTemplateContext", () => {
  test("creates context from flat parameters", () => {
    const context = createTemplateContext({
      worktreePath: "/path/to/worktree",
      worktreeBranch: "my-branch",
      taskId: "task_abc",
      changePath: "/path/to/change",
      stepType: "test",
      executionId: "exec_xyz",
    });

    expect(context).toEqual({
      worktree: {
        path: "/path/to/worktree",
        branch: "my-branch",
      },
      task: {
        id: "task_abc",
        changePath: "/path/to/change",
      },
      step: {
        type: "test",
        executionId: "exec_xyz",
      },
    });
  });
});

describe("TemplateResolutionError", () => {
  test("has correct name and message", () => {
    const error = new TemplateResolutionError("test error");

    expect(error.name).toBe("TemplateResolutionError");
    expect(error.message).toBe("test error");
    expect(error).toBeInstanceOf(Error);
  });
});
