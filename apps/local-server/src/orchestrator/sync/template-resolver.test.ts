import { describe, expect, test } from "bun:test";
import { createTemplateLoader } from "../../prompts/template-loader.ts";
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
      iteration: 2,
    });

    expect(context.worktree.path).toBe("/path/to/worktree");
    expect(context.worktree.branch).toBe("feature-branch");
    expect(context.task.id).toBe("task-123");
    expect(context.task.changePath).toBe("changes/my-change");
    expect(context.step.type).toBe("implement");
    expect(context.step.executionId).toBe("exec-456");
    expect(context.step.iteration).toBe(2);
  });
});

describe("createTemplateContext", () => {
  test("includes signals when provided", () => {
    const signals = [
      { name: "CHUNK_DONE", description: "completed a chunk" },
      { name: "TASK_COMPLETE", description: "all tasks done" },
    ];

    const context = createTemplateContext({
      worktreePath: "/path",
      worktreeBranch: "branch",
      taskId: "task-1",
      changePath: "changes/feat",
      stepType: "implement",
      executionId: "exec-1",
      iteration: 0,
      signals,
    });

    expect(context.signals).toEqual(signals);
  });

  test("signals is undefined when not provided", () => {
    const context = createTemplateContext({
      worktreePath: "/path",
      worktreeBranch: "branch",
      taskId: "task-1",
      changePath: "changes/feat",
      stepType: "implement",
      executionId: "exec-1",
      iteration: 0,
    });

    expect(context.signals).toBeUndefined();
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
    iteration: 0,
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

  test("resolves step.iteration placeholder", () => {
    const contextWithIteration = createTemplateContext({
      worktreePath: "/repo/.worktrees/task-1",
      worktreeBranch: "aop/task-1",
      taskId: "task-1",
      changePath: "changes/feature",
      stepType: "review",
      executionId: "exec-2",
      iteration: 3,
    });
    const template = "Review iteration {{step.iteration}}";
    const result = resolveTemplate(template, contextWithIteration);

    expect(result).toBe("Review iteration 3");
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

  test("resolves signals with each block", () => {
    const contextWithSignals = createTemplateContext({
      worktreePath: "/repo/.worktrees/task-1",
      worktreeBranch: "aop/task-1",
      taskId: "task-1",
      changePath: "changes/feature",
      stepType: "implement",
      executionId: "exec-1",
      iteration: 0,
      signals: [
        { name: "CHUNK_DONE", description: "completed a chunk" },
        { name: "TASK_COMPLETE", description: "all tasks done" },
      ],
    });
    const template =
      "{{#each signals}}\n- `<aop>{{this.name}}</aop>` — {{this.description}}\n{{/each}}";
    const result = resolveTemplate(template, contextWithSignals);

    expect(result).toContain("- `<aop>CHUNK_DONE</aop>` — completed a chunk");
    expect(result).toContain("- `<aop>TASK_COMPLETE</aop>` — all tasks done");
  });

  test("resolves empty signals with if block", () => {
    const template = "{{#if signals}}Signals section{{/if}}";
    const result = resolveTemplate(template, baseContext);

    expect(result).toBe("");
  });

  test("resolves input placeholder when provided", () => {
    const contextWithInput = createTemplateContext({
      worktreePath: "/repo/.worktrees/task-1",
      worktreeBranch: "aop/task-1",
      taskId: "task-1",
      changePath: "changes/feature",
      stepType: "implement",
      executionId: "exec-1",
      iteration: 0,
      input: "Approved. Proceed with the plan.",
    });
    const template = "{{#if input}}User said: {{input}}{{/if}}";
    const result = resolveTemplate(template, contextWithInput);

    expect(result).toBe("User said: Approved. Proceed with the plan.");
  });

  test("omits input section when input not provided", () => {
    const template = "{{#if input}}User said: {{input}}{{/if}}";
    const result = resolveTemplate(template, baseContext);

    expect(result).toBe("");
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
      {{step.iteration}}
      {{input}}
      {{this.name}}
      {{this.description}}
    `;
    const result = validateTemplate(template);

    expect(result).toEqual([]);
  });

  test("rejects humanInput as unknown placeholder", () => {
    const template = "{{humanInput}}";
    const result = validateTemplate(template);

    expect(result).toContain("humanInput");
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

describe("end-to-end template resolution", () => {
  const loader = createTemplateLoader();

  test("resolves run-tests template with signals to exact expected output", async () => {
    const template = await loader.load("run-tests.md.hbs");
    const context = createTemplateContext({
      worktreePath: "/repo/.worktrees/task-42",
      worktreeBranch: "aop/task-42",
      taskId: "task-42",
      changePath: "changes/add-auth",
      stepType: "run-tests",
      executionId: "step-99",
      iteration: 1,
      signals: [
        { name: "TESTS_PASS", description: "all tests pass" },
        { name: "TESTS_FAIL", description: "one or more tests failed" },
      ],
    });

    const result = resolveTemplate(template, context);

    expect(result).toContain(
      "Run the required local non-E2E verification for the implementation at /repo/.worktrees/task-42.",
    );
    expect(result).toContain("Read `.github/workflows/aop-ci.yml`");
    expect(result).toContain("bun run build");
    expect(result).toContain("bun run test:ci");
    expect(result).toContain("Do not claim success unless you ran the commands you list");
    expect(result).toContain("Update `agent-review-report.md`");
    expect(result).toContain("`<aop>TESTS_PASS</aop>` — all tests pass");
    expect(result).toContain("`<aop>TESTS_FAIL</aop>` — one or more tests failed");
  });

  test("resolves run-tests template without signals omits signals section", async () => {
    const template = await loader.load("run-tests.md.hbs");
    const context = createTemplateContext({
      worktreePath: "/repo/.worktrees/task-7",
      worktreeBranch: "aop/task-7",
      taskId: "task-7",
      changePath: "changes/refactor",
      stepType: "run-tests",
      executionId: "step-50",
      iteration: 0,
    });

    const result = resolveTemplate(template, context);

    expect(result).toContain(
      "Run the required local non-E2E verification for the implementation at /repo/.worktrees/task-7.",
    );
    expect(result).toContain("smallest workspace-scoped commands");
    expect(result).not.toContain("## Signals (REQUIRED)");
  });

  test("resolves run-tests template with input section", async () => {
    const template = await loader.load("run-tests.md.hbs");
    const context = createTemplateContext({
      worktreePath: "/repo/.worktrees/task-10",
      worktreeBranch: "aop/task-10",
      taskId: "task-10",
      changePath: "changes/bugfix",
      stepType: "run-tests",
      executionId: "step-20",
      iteration: 0,
      signals: [{ name: "TESTS_PASS", description: "all tests pass" }],
    });
    const contextWithInput = { ...context, input: "Focus on auth module tests only" };

    const result = resolveTemplate(template, contextWithInput);

    expect(result).toContain("Focus on auth module tests only");
    expect(result).toContain(
      "Run the required local non-E2E verification for the implementation at /repo/.worktrees/task-10.",
    );
    expect(result).toContain("Update `agent-review-report.md`");
    expect(result).toContain("`<aop>TESTS_PASS</aop>` — all tests pass");
  });
});
