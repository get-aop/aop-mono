import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LLMProvider, RunOptions, RunResult } from "@aop/llm-provider";
import type { Kysely } from "kysely";
import { createCommandContext, type LocalServerContext } from "../../context.ts";
import type { Database } from "../../db/schema.ts";
import { createTestDb, createTestRepo } from "../../db/test-utils.ts";

interface ImportPlannerModule {
  createLinearImportPlanner(options: { ctx: LocalServerContext; provider?: LLMProvider }): {
    planTasks(params: { taskIds: string[] }): Promise<void>;
  };
}

const loadImportPlannerModule = async (): Promise<ImportPlannerModule> =>
  (await import("./import-planner.ts")) as ImportPlannerModule;

describe("integrations/linear/import-planner", () => {
  let db: Kysely<Database>;
  let ctx: LocalServerContext;
  let repoPath: string;

  beforeEach(async () => {
    db = await createTestDb();
    ctx = createCommandContext(db);
    repoPath = await mkdtemp(join(tmpdir(), "aop-linear-import-planner-"));
    await createTestRepo(db, "repo-1", repoPath);

    await ctx.taskRepository.createIdempotent({
      id: "task-1",
      repo_id: "repo-1",
      change_path: "docs/tasks/get-42-adopt-orchestration-patterns",
      status: "DRAFT",
      worktree_path: null,
      ready_at: null,
    });

    await writeFile(
      join(repoPath, "docs/tasks/get-42-adopt-orchestration-patterns/task.md"),
      [
        "---",
        "id: task-1",
        "title: Adopt orchestration patterns",
        "status: DRAFT",
        "created: 2026-03-14T00:00:00.000Z",
        "changePath: docs/tasks/get-42-adopt-orchestration-patterns",
        "---",
        "",
        "## Description",
        "Imported from Linear `GET-42`.",
        "",
        "## Requirements",
        "- Improve orchestration reliability.",
        "",
        "## Acceptance Criteria",
        "- [ ] A real implementation plan exists.",
        "",
      ].join("\n"),
    );
    await writeFile(
      join(repoPath, "docs/tasks/get-42-adopt-orchestration-patterns/plan.md"),
      [
        "---",
        "status: INPROGRESS",
        "task: get-42-adopt-orchestration-patterns",
        "created: 2026-03-14T00:00:00.000Z",
        "---",
        "",
        "## Subtasks",
        "1. 001-placeholder (Placeholder)",
        "",
      ].join("\n"),
    );
    await writeFile(
      join(repoPath, "docs/tasks/get-42-adopt-orchestration-patterns/001-placeholder.md"),
      [
        "---",
        "title: Placeholder",
        "status: PENDING",
        "dependencies: []",
        "---",
        "",
        "### Description",
        "Placeholder",
        "",
        "### Context",
        "",
        "### Result",
        "",
        "### Review",
        "",
        "### Blockers",
        "",
      ].join("\n"),
    );
  });

  afterEach(async () => {
    await db.destroy();
    await rm(repoPath, { recursive: true, force: true });
  });

  test("runs a provider-backed planning pass that writes substantive plan and subtask docs", async () => {
    const { createLinearImportPlanner } = await loadImportPlannerModule();
    const planner = createLinearImportPlanner({
      ctx,
      provider: new FakePlanningProvider(),
    });

    await planner.planTasks({ taskIds: ["task-1"] });

    const planContent = await Bun.file(
      join(repoPath, "docs/tasks/get-42-adopt-orchestration-patterns/plan.md"),
    ).text();
    const subtaskContent = await Bun.file(
      join(repoPath, "docs/tasks/get-42-adopt-orchestration-patterns/001-map-runtime-events.md"),
    ).text();

    expect(planContent).toContain("## Summary");
    expect(planContent).toContain("## Verification");
    expect(subtaskContent).toContain("### Description");
    expect(subtaskContent).toContain("Capture the event contract");
    expect(subtaskContent).toContain("### Context");
    expect(subtaskContent).toContain("apps/local-server/src/orchestrator");
    expect(
      await Bun.file(
        join(repoPath, "docs/tasks/get-42-adopt-orchestration-patterns/001-placeholder.md"),
      ).exists(),
    ).toBe(false);
  });

  test("finishes once substantive planning docs exist even if the provider process hangs", async () => {
    const { createLinearImportPlanner } = await loadImportPlannerModule();
    const planner = createLinearImportPlanner({
      ctx,
      provider: new HangingPlanningProvider(),
    });

    await planner.planTasks({ taskIds: ["task-1"] });

    const planContent = await Bun.file(
      join(repoPath, "docs/tasks/get-42-adopt-orchestration-patterns/plan.md"),
    ).text();
    const subtaskContent = await Bun.file(
      join(repoPath, "docs/tasks/get-42-adopt-orchestration-patterns/001-map-runtime-events.md"),
    ).text();

    expect(planContent).toContain("## Summary");
    expect(subtaskContent).toContain("### Description");
  });
});

class FakePlanningProvider implements LLMProvider {
  readonly name = "fake-planner";

  async run(options: RunOptions): Promise<RunResult> {
    const taskPath = extractTaskPath(options.prompt);
    if (!taskPath) {
      throw new Error("Expected task path in planning prompt");
    }

    await writeFile(
      join(taskPath, "plan.md"),
      [
        "---",
        "status: INPROGRESS",
        "task: get-42-adopt-orchestration-patterns",
        "created: 2026-03-14T00:00:00.000Z",
        "---",
        "",
        "## Summary",
        "Define the orchestration upgrade in executable slices and capture the verification path.",
        "",
        "## Context",
        "- Based on imported Linear task GET-42.",
        "- The orchestrator code lives under apps/local-server/src/orchestrator.",
        "",
        "## Subtasks",
        "1. 001-map-runtime-events (Map runtime events)",
        "",
        "## Verification",
        "- [ ] bun test apps/local-server",
        "",
      ].join("\n"),
    );
    await writeFile(
      join(taskPath, "001-map-runtime-events.md"),
      [
        "---",
        "title: Map runtime events",
        "status: PENDING",
        "dependencies: []",
        "---",
        "",
        "### Description",
        "Capture the event contract needed for the orchestration upgrade.",
        "",
        "### Context",
        "- apps/local-server/src/orchestrator",
        "- apps/local-server/src/workflow-engine",
        "",
        "### Result",
        "",
        "### Review",
        "",
        "### Blockers",
        "",
      ].join("\n"),
    );

    if (options.logFilePath) {
      await writeFile(
        options.logFilePath,
        [
          JSON.stringify({ type: "thread.started", thread_id: "fake-planner" }),
          JSON.stringify({
            type: "item.completed",
            item: {
              type: "agent_message",
              text: "Planning complete.\n<aop>PLAN_READY</aop>",
            },
          }),
          JSON.stringify({
            type: "turn.completed",
            "last-assistant-message": "Planning complete.\n<aop>PLAN_READY</aop>",
          }),
          "",
        ].join("\n"),
      );
    }

    return { exitCode: 0 };
  }
}

class HangingPlanningProvider implements LLMProvider {
  readonly name = "hanging-planner";

  async run(options: RunOptions): Promise<RunResult> {
    const taskPath = extractTaskPath(options.prompt);
    if (!taskPath) {
      throw new Error("Expected task path in planning prompt");
    }

    await new FakePlanningProvider().run(options);

    const sleeper = Bun.spawn({
      cmd: ["sleep", "60"],
      stdout: "ignore",
      stderr: "ignore",
      stdin: "ignore",
    });
    await options.onSpawn?.(sleeper.pid);

    const exitCode = await sleeper.exited;
    return { exitCode, pid: sleeper.pid };
  }
}

const extractTaskPath = (prompt: string): string | null => {
  const match = prompt.match(/- \*\*Task Path\*\*: ([^\n]+)/);
  return match?.[1]?.trim() ?? null;
};
