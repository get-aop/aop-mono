import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitManager } from "@aop/git-manager";
import { aopPaths, useTestAopHome } from "@aop/infra";
import { Hono } from "hono";
import type { Kysely } from "kysely";
import { createApp } from "../app.ts";
import { createCommandContext, type LocalServerContext } from "../context.ts";
import type { Database } from "../db/schema.ts";
import { type AnyJson, createTestDb, createTestRepo, createTestTask } from "../db/test-utils.ts";
import { ExecutionStatus } from "../executor/execution-types.ts";
import { createRepoRoutes } from "../repo/routes.ts";

describe("task/routes", () => {
  let db: Kysely<Database>;
  let ctx: LocalServerContext;
  let app: Hono;
  let cleanupAopHome: () => void;

  beforeEach(async () => {
    cleanupAopHome = useTestAopHome();
    db = await createTestDb();
    ctx = createCommandContext(db);
    app = new Hono();
    app.route("/api/repos", createRepoRoutes(ctx));
  });

  afterEach(async () => {
    await db.destroy();
    cleanupAopHome();
  });

  describe("GET /api/repos/:repoId/tasks/:taskId/executions", () => {
    test("returns 404 for non-existent repo", async () => {
      const res = await app.request("/api/repos/non-existent/tasks/task-1/executions");
      const body: AnyJson = await res.json();

      expect(res.status).toBe(404);
      expect(body.error).toBe("Repo not found");
    });

    test("returns 404 for non-existent task", async () => {
      await createTestRepo(db, "repo-1", "/path/to/repo");

      const res = await app.request("/api/repos/repo-1/tasks/non-existent/executions");
      const body: AnyJson = await res.json();

      expect(res.status).toBe(404);
      expect(body.error).toBe("Task not found");
    });

    test("returns 404 when task belongs to different repo", async () => {
      await createTestRepo(db, "repo-1", "/path/to/repo1");
      await createTestRepo(db, "repo-2", "/path/to/repo2");
      await createTestTask(db, "task-1", "repo-2", "changes/feat", "WORKING");

      const res = await app.request("/api/repos/repo-1/tasks/task-1/executions");
      const body: AnyJson = await res.json();

      expect(res.status).toBe(404);
      expect(body.error).toBe("Task not found");
    });

    test("returns empty array for task with no executions", async () => {
      await createTestRepo(db, "repo-1", "/path/to/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat", "DRAFT");

      const res = await app.request("/api/repos/repo-1/tasks/task-1/executions");
      const body: AnyJson = await res.json();

      expect(res.status).toBe(200);
      expect(body.executions).toEqual([]);
    });

    test("returns executions for task", async () => {
      await createTestRepo(db, "repo-1", "/path/to/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat", "WORKING");

      await ctx.executionRepository.createExecution({
        id: "exec-1",
        task_id: "task-1",
        status: ExecutionStatus.COMPLETED,
        started_at: "2024-01-01T00:00:00.000Z",
      });

      const res = await app.request("/api/repos/repo-1/tasks/task-1/executions");
      const body: AnyJson = await res.json();

      expect(res.status).toBe(200);
      expect(body.executions).toHaveLength(1);
      expect(body.executions[0].id).toBe("exec-1");
      expect(body.executions[0].taskId).toBe("task-1");
      expect(body.executions[0].status).toBe("completed");
    });

    test("transforms aborted/cancelled status to failed", async () => {
      await createTestRepo(db, "repo-1", "/path/to/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat", "BLOCKED");

      await ctx.executionRepository.createExecution({
        id: "exec-1",
        task_id: "task-1",
        status: ExecutionStatus.ABORTED,
        started_at: "2024-01-01T00:00:00.000Z",
      });
      await ctx.executionRepository.createExecution({
        id: "exec-2",
        task_id: "task-1",
        status: ExecutionStatus.CANCELLED,
        started_at: "2024-01-01T00:01:00.000Z",
      });

      const res = await app.request("/api/repos/repo-1/tasks/task-1/executions");
      const body: AnyJson = await res.json();

      expect(res.status).toBe(200);
      expect(body.executions).toHaveLength(2);
      expect(body.executions[0].status).toBe("failed");
      expect(body.executions[1].status).toBe("failed");
    });

    test("returns executions with empty steps array when no steps exist", async () => {
      await createTestRepo(db, "repo-1", "/path/to/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat", "WORKING");

      await ctx.executionRepository.createExecution({
        id: "exec-1",
        task_id: "task-1",
        status: ExecutionStatus.COMPLETED,
        started_at: "2024-01-01T00:00:00.000Z",
      });

      const res = await app.request("/api/repos/repo-1/tasks/task-1/executions");
      const body: AnyJson = await res.json();

      expect(res.status).toBe(200);
      expect(body.executions).toHaveLength(1);
      expect(body.executions[0].steps).toEqual([]);
    });

    test("returns executions with step data including stepType", async () => {
      await createTestRepo(db, "repo-1", "/path/to/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat", "WORKING");

      await ctx.executionRepository.createExecution({
        id: "exec-1",
        task_id: "task-1",
        status: ExecutionStatus.RUNNING,
        started_at: "2024-01-01T00:00:00.000Z",
      });

      await ctx.executionRepository.createStepExecution({
        id: "step-1",
        execution_id: "exec-1",
        step_type: "implement",
        status: "success",
        started_at: "2024-01-01T00:00:00.000Z",
        ended_at: "2024-01-01T00:05:00.000Z",
      });

      await ctx.executionRepository.createStepExecution({
        id: "step-2",
        execution_id: "exec-1",
        step_type: "review",
        status: "running",
        started_at: "2024-01-01T00:05:00.000Z",
      });

      const res = await app.request("/api/repos/repo-1/tasks/task-1/executions");
      const body: AnyJson = await res.json();

      expect(res.status).toBe(200);
      expect(body.executions).toHaveLength(1);
      expect(body.executions[0].steps).toHaveLength(2);

      expect(body.executions[0].steps[0].id).toBe("step-1");
      expect(body.executions[0].steps[0].stepType).toBe("implement");
      expect(body.executions[0].steps[0].status).toBe("success");
      expect(body.executions[0].steps[0].startedAt).toBe("2024-01-01T00:00:00.000Z");
      expect(body.executions[0].steps[0].endedAt).toBe("2024-01-01T00:05:00.000Z");

      expect(body.executions[0].steps[1].id).toBe("step-2");
      expect(body.executions[0].steps[1].stepType).toBe("review");
      expect(body.executions[0].steps[1].status).toBe("running");
      expect(body.executions[0].steps[1].endedAt).toBeUndefined();
    });

    test("returns steps ordered by startedAt ascending", async () => {
      await createTestRepo(db, "repo-1", "/path/to/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat", "WORKING");

      await ctx.executionRepository.createExecution({
        id: "exec-1",
        task_id: "task-1",
        status: ExecutionStatus.RUNNING,
        started_at: "2024-01-01T00:00:00.000Z",
      });

      await ctx.executionRepository.createStepExecution({
        id: "step-2",
        execution_id: "exec-1",
        step_type: "review",
        status: "running",
        started_at: "2024-01-01T00:05:00.000Z",
      });

      await ctx.executionRepository.createStepExecution({
        id: "step-1",
        execution_id: "exec-1",
        step_type: "implement",
        status: "success",
        started_at: "2024-01-01T00:00:00.000Z",
        ended_at: "2024-01-01T00:05:00.000Z",
      });

      const res = await app.request("/api/repos/repo-1/tasks/task-1/executions");
      const body: AnyJson = await res.json();

      expect(res.status).toBe(200);
      expect(body.executions[0].steps[0].stepType).toBe("implement");
      expect(body.executions[0].steps[1].stepType).toBe("review");
    });

    test("returns step error when present", async () => {
      await createTestRepo(db, "repo-1", "/path/to/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat", "BLOCKED");

      await ctx.executionRepository.createExecution({
        id: "exec-1",
        task_id: "task-1",
        status: ExecutionStatus.FAILED,
        started_at: "2024-01-01T00:00:00.000Z",
      });

      await ctx.executionRepository.createStepExecution({
        id: "step-1",
        execution_id: "exec-1",
        step_type: "implement",
        status: "failure",
        started_at: "2024-01-01T00:00:00.000Z",
        ended_at: "2024-01-01T00:05:00.000Z",
        error: "Build failed: syntax error",
      });

      const res = await app.request("/api/repos/repo-1/tasks/task-1/executions");
      const body: AnyJson = await res.json();

      expect(res.status).toBe(200);
      expect(body.executions[0].steps[0].error).toBe("Build failed: syntax error");
    });
  });

  describe("POST /api/repos/:repoId/tasks/:taskId/ready", () => {
    const changePath = "changes/feat";

    const createTasksFile = (repoId: string) => {
      const dir = join(aopPaths.repoDir(repoId), changePath);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "tasks.md"), "# Tasks\n- [ ] Task 1");
    };

    test("returns 404 for non-existent repo", async () => {
      const res = await app.request("/api/repos/non-existent/tasks/task-1/ready", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const body: AnyJson = await res.json();

      expect(res.status).toBe(404);
      expect(body.error).toBe("Repo not found");
    });

    test("returns 404 for non-existent task", async () => {
      await createTestRepo(db, "repo-1", "/path/to/repo");

      const res = await app.request("/api/repos/repo-1/tasks/non-existent/ready", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const body: AnyJson = await res.json();

      expect(res.status).toBe(404);
      expect(body.error).toBe("Task not found");
    });

    test("returns 404 when task belongs to different repo", async () => {
      await createTestRepo(db, "repo-1", "/path/to/repo1");
      await createTestRepo(db, "repo-2", "/path/to/repo2");
      await createTestTask(db, "task-1", "repo-2", changePath, "DRAFT");

      const res = await app.request("/api/repos/repo-1/tasks/task-1/ready", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const body: AnyJson = await res.json();

      expect(res.status).toBe(404);
      expect(body.error).toBe("Task not found");
    });

    test("returns 422 when tasks.md is missing", async () => {
      await createTestRepo(db, "repo-1", "/path/to/repo");
      await createTestTask(db, "task-1", "repo-1", changePath, "DRAFT");

      const res = await app.request("/api/repos/repo-1/tasks/task-1/ready", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const body: AnyJson = await res.json();

      expect(res.status).toBe(422);
      expect(body.error).toBe("Change is missing tasks.md file");
      expect(body.changePath).toBe(changePath);
    });

    test("marks DRAFT task as ready", async () => {
      await createTestRepo(db, "repo-1", "/path/to/repo");
      await createTestTask(db, "task-1", "repo-1", changePath, "DRAFT");
      createTasksFile("repo-1");

      const res = await app.request("/api/repos/repo-1/tasks/task-1/ready", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const body: AnyJson = await res.json();

      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.taskId).toBe("task-1");
    });

    test("marks BLOCKED task as ready", async () => {
      await createTestRepo(db, "repo-1", "/path/to/repo");
      await createTestTask(db, "task-1", "repo-1", changePath, "BLOCKED");
      createTasksFile("repo-1");

      const res = await app.request("/api/repos/repo-1/tasks/task-1/ready", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const body: AnyJson = await res.json();

      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
    });

    test("returns alreadyReady=true for READY task", async () => {
      await createTestRepo(db, "repo-1", "/path/to/repo");
      await createTestTask(db, "task-1", "repo-1", changePath, "READY");

      const res = await app.request("/api/repos/repo-1/tasks/task-1/ready", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const body: AnyJson = await res.json();

      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.alreadyReady).toBe(true);
    });

    test("returns 409 for WORKING task", async () => {
      await createTestRepo(db, "repo-1", "/path/to/repo");
      await createTestTask(db, "task-1", "repo-1", changePath, "WORKING");

      const res = await app.request("/api/repos/repo-1/tasks/task-1/ready", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const body: AnyJson = await res.json();

      expect(res.status).toBe(409);
      expect(body.error).toBe("Invalid task status");
      expect(body.status).toBe("WORKING");
    });

    test("accepts workflow parameter", async () => {
      await createTestRepo(db, "repo-1", "/path/to/repo");
      await createTestTask(db, "task-1", "repo-1", changePath, "DRAFT");
      createTasksFile("repo-1");

      const res = await app.request("/api/repos/repo-1/tasks/task-1/ready", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workflow: "custom-workflow" }),
      });

      expect(res.status).toBe(200);

      const task = await ctx.taskRepository.get("task-1");
      expect(task?.preferred_workflow).toBe("custom-workflow");
    });

    test("accepts baseBranch parameter", async () => {
      await createTestRepo(db, "repo-1", "/path/to/repo");
      await createTestTask(db, "task-1", "repo-1", changePath, "DRAFT");
      createTasksFile("repo-1");

      const res = await app.request("/api/repos/repo-1/tasks/task-1/ready", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseBranch: "release/v2" }),
      });

      expect(res.status).toBe(200);

      const task = await ctx.taskRepository.get("task-1");
      expect(task?.base_branch).toBe("release/v2");
    });

    test("accepts provider parameter", async () => {
      await createTestRepo(db, "repo-1", "/path/to/repo");
      await createTestTask(db, "task-1", "repo-1", changePath, "DRAFT");
      createTasksFile("repo-1");

      const res = await app.request("/api/repos/repo-1/tasks/task-1/ready", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "cursor-cli:composer-1.5" }),
      });

      expect(res.status).toBe(200);

      const task = await ctx.taskRepository.get("task-1");
      expect(task?.preferred_provider).toBe("cursor-cli:composer-1.5");
    });
  });

  describe("DELETE /api/repos/:repoId/tasks/:taskId", () => {
    test("returns 404 for non-existent repo", async () => {
      const res = await app.request("/api/repos/non-existent/tasks/task-1", {
        method: "DELETE",
      });
      const body: AnyJson = await res.json();

      expect(res.status).toBe(404);
      expect(body.error).toBe("Repo not found");
    });

    test("returns 404 for non-existent task", async () => {
      await createTestRepo(db, "repo-1", "/path/to/repo");

      const res = await app.request("/api/repos/repo-1/tasks/non-existent", {
        method: "DELETE",
      });
      const body: AnyJson = await res.json();

      expect(res.status).toBe(404);
      expect(body.error).toBe("Task not found");
    });

    test("removes DRAFT task", async () => {
      await createTestRepo(db, "repo-1", "/path/to/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat", "DRAFT");

      const res = await app.request("/api/repos/repo-1/tasks/task-1", {
        method: "DELETE",
      });
      const body: AnyJson = await res.json();

      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.taskId).toBe("task-1");
      expect(body.aborted).toBe(false);
    });

    test("removes READY task", async () => {
      await createTestRepo(db, "repo-1", "/path/to/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat", "READY");

      const res = await app.request("/api/repos/repo-1/tasks/task-1", {
        method: "DELETE",
      });
      const body: AnyJson = await res.json();

      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
    });

    test("returns alreadyRemoved=true for REMOVED task", async () => {
      await createTestRepo(db, "repo-1", "/path/to/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat", "REMOVED");

      const res = await app.request("/api/repos/repo-1/tasks/task-1", {
        method: "DELETE",
      });
      const body: AnyJson = await res.json();

      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.alreadyRemoved).toBe(true);
    });

    test("returns 409 for WORKING task without force", async () => {
      await createTestRepo(db, "repo-1", "/path/to/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat", "WORKING");

      const res = await app.request("/api/repos/repo-1/tasks/task-1", {
        method: "DELETE",
      });
      const body: AnyJson = await res.json();

      expect(res.status).toBe(409);
      expect(body.error).toBe("Task is currently working, use force=true to abort");
    });
  });

  describe("POST /api/repos/:repoId/tasks/:taskId/block", () => {
    test("returns 404 for non-existent repo", async () => {
      const res = await app.request("/api/repos/non-existent/tasks/task-1/block", {
        method: "POST",
      });
      const body: AnyJson = await res.json();

      expect(res.status).toBe(404);
      expect(body.error).toBe("Repo not found");
    });

    test("returns 404 for non-existent task", async () => {
      await createTestRepo(db, "repo-1", "/path/to/repo");

      const res = await app.request("/api/repos/repo-1/tasks/non-existent/block", {
        method: "POST",
      });
      const body: AnyJson = await res.json();

      expect(res.status).toBe(404);
      expect(body.error).toBe("Task not found");
    });

    test("returns 404 when task belongs to different repo", async () => {
      await createTestRepo(db, "repo-1", "/path/to/repo1");
      await createTestRepo(db, "repo-2", "/path/to/repo2");
      await createTestTask(db, "task-1", "repo-2", "changes/feat", "WORKING");

      const res = await app.request("/api/repos/repo-1/tasks/task-1/block", {
        method: "POST",
      });
      const body: AnyJson = await res.json();

      expect(res.status).toBe(404);
      expect(body.error).toBe("Task not found");
    });

    test("returns 409 for non-WORKING task", async () => {
      await createTestRepo(db, "repo-1", "/path/to/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat", "DRAFT");

      const res = await app.request("/api/repos/repo-1/tasks/task-1/block", {
        method: "POST",
      });
      const body: AnyJson = await res.json();

      expect(res.status).toBe(409);
      expect(body.error).toBe("Task is not currently working");
      expect(body.status).toBe("DRAFT");
    });

    test("blocks WORKING task successfully", async () => {
      await createTestRepo(db, "repo-1", "/path/to/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat", "WORKING");

      const res = await app.request("/api/repos/repo-1/tasks/task-1/block", {
        method: "POST",
      });
      const body: AnyJson = await res.json();

      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.taskId).toBe("task-1");
      expect(body.agentKilled).toBeDefined();
    });
  });

  describe("POST /api/repos/:repoId/tasks/:taskId/apply", () => {
    test("returns 404 for non-existent repo", async () => {
      const res = await app.request("/api/repos/non-existent/tasks/task-1/apply", {
        method: "POST",
      });
      const body: AnyJson = await res.json();

      expect(res.status).toBe(404);
      expect(body.error).toBe("Repo not found");
    });

    test("returns 404 for non-existent task", async () => {
      await createTestRepo(db, "repo-1", "/path/to/repo");

      const res = await app.request("/api/repos/repo-1/tasks/non-existent/apply", {
        method: "POST",
      });
      const body: AnyJson = await res.json();

      expect(res.status).toBe(404);
      expect(body.error).toBe("Task not found");
    });

    test("returns 404 when task belongs to different repo", async () => {
      await createTestRepo(db, "repo-1", "/path/to/repo1");
      await createTestRepo(db, "repo-2", "/path/to/repo2");
      await createTestTask(db, "task-1", "repo-2", "changes/feat", "DONE");

      const res = await app.request("/api/repos/repo-1/tasks/task-1/apply", {
        method: "POST",
      });
      const body: AnyJson = await res.json();

      expect(res.status).toBe(404);
      expect(body.error).toBe("Task not found");
    });

    test("returns 409 for task with invalid status", async () => {
      await createTestRepo(db, "repo-1", "/path/to/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat", "DRAFT");

      const res = await app.request("/api/repos/repo-1/tasks/task-1/apply", {
        method: "POST",
      });
      const body: AnyJson = await res.json();

      expect(res.status).toBe(409);
      expect(body.error).toBe("Invalid task status");
      expect(body.status).toBe("DRAFT");
    });

    test("returns 409 for READY task", async () => {
      await createTestRepo(db, "repo-1", "/path/to/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat", "READY");

      const res = await app.request("/api/repos/repo-1/tasks/task-1/apply", {
        method: "POST",
      });
      const body: AnyJson = await res.json();

      expect(res.status).toBe(409);
      expect(body.error).toBe("Invalid task status");
      expect(body.status).toBe("READY");
    });

    test("returns 409 for WORKING task", async () => {
      await createTestRepo(db, "repo-1", "/path/to/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat", "WORKING");

      const res = await app.request("/api/repos/repo-1/tasks/task-1/apply", {
        method: "POST",
      });
      const body: AnyJson = await res.json();

      expect(res.status).toBe(409);
      expect(body.error).toBe("Invalid task status");
      expect(body.status).toBe("WORKING");
    });
  });

  describe("POST /api/repos/:repoId/tasks/:taskId/apply - git operations", () => {
    let testRepoPath: string;

    beforeEach(async () => {
      testRepoPath = join(tmpdir(), `aop-test-apply-routes-${Date.now()}`);
      mkdirSync(testRepoPath, { recursive: true });

      const initProc = Bun.spawn(["git", "init", "-b", "main"], {
        cwd: testRepoPath,
      });
      await initProc.exited;

      const configName = Bun.spawn(["git", "config", "user.name", "Test"], {
        cwd: testRepoPath,
      });
      await configName.exited;

      const configEmail = Bun.spawn(["git", "config", "user.email", "test@test.com"], {
        cwd: testRepoPath,
      });
      await configEmail.exited;

      writeFileSync(join(testRepoPath, "README.md"), "# Test");
      const addProc = Bun.spawn(["git", "add", "."], { cwd: testRepoPath });
      await addProc.exited;

      const commitProc = Bun.spawn(["git", "commit", "-m", "Initial commit"], {
        cwd: testRepoPath,
      });
      await commitProc.exited;
    });

    afterEach(() => {
      if (existsSync(testRepoPath)) {
        rmSync(testRepoPath, { recursive: true });
      }
    });

    test("returns 404 for WORKTREE_NOT_FOUND", async () => {
      await createTestRepo(db, "repo-1", testRepoPath);
      await createTestTask(db, "task-1", "repo-1", "changes/feat", "DONE");

      const res = await app.request("/api/repos/repo-1/tasks/task-1/apply", {
        method: "POST",
      });
      const body: AnyJson = await res.json();

      expect(res.status).toBe(404);
      expect(body.error).toBe("Worktree not found");
    });

    test("returns NO_CHANGES when worktree has no changes", async () => {
      await createTestRepo(db, "repo-1", testRepoPath);
      await createTestTask(db, "task-1", "repo-1", "changes/feat", "DONE");

      const gitManager = new GitManager({ repoPath: testRepoPath, repoId: "repo-1" });
      await gitManager.init();
      await gitManager.createWorktree("task-1", "main");

      const res = await app.request("/api/repos/repo-1/tasks/task-1/apply", {
        method: "POST",
      });
      const body: AnyJson = await res.json();

      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.noChanges).toBe(true);
    });

    test("returns 409 for DIRTY_WORKING_DIRECTORY", async () => {
      await createTestRepo(db, "repo-1", testRepoPath);
      await createTestTask(db, "task-1", "repo-1", "changes/feat", "DONE");

      const gitManager = new GitManager({ repoPath: testRepoPath, repoId: "repo-1" });
      await gitManager.init();
      const worktreeInfo = await gitManager.createWorktree("task-1", "main");

      // Add changes to worktree
      writeFileSync(join(worktreeInfo.path, "new-file.txt"), "New content");
      const addProc = Bun.spawn(["git", "add", "."], {
        cwd: worktreeInfo.path,
      });
      await addProc.exited;
      const commitProc = Bun.spawn(["git", "commit", "-m", "Add new file"], {
        cwd: worktreeInfo.path,
      });
      await commitProc.exited;

      // Add uncommitted changes to main repo
      writeFileSync(join(testRepoPath, "dirty-file.txt"), "Uncommitted");

      const res = await app.request("/api/repos/repo-1/tasks/task-1/apply", {
        method: "POST",
      });
      const body: AnyJson = await res.json();

      expect(res.status).toBe(409);
      expect(body.error).toBe("Main repository has uncommitted changes");
    });

    test("applies with conflicts and returns conflicting files", async () => {
      await createTestRepo(db, "repo-1", testRepoPath);
      await createTestTask(db, "task-1", "repo-1", "changes/feat", "DONE");

      const gitManager = new GitManager({ repoPath: testRepoPath, repoId: "repo-1" });
      await gitManager.init();
      const worktreeInfo = await gitManager.createWorktree("task-1", "main");

      // Modify README in worktree
      writeFileSync(join(worktreeInfo.path, "README.md"), "# Modified in worktree");
      const addProc = Bun.spawn(["git", "add", "."], {
        cwd: worktreeInfo.path,
      });
      await addProc.exited;
      const commitProc = Bun.spawn(["git", "commit", "-m", "Modify README"], {
        cwd: worktreeInfo.path,
      });
      await commitProc.exited;

      // Modify README in main repo
      writeFileSync(join(testRepoPath, "README.md"), "# Modified in main");
      const addMainProc = Bun.spawn(["git", "add", "."], { cwd: testRepoPath });
      await addMainProc.exited;
      const commitMainProc = Bun.spawn(["git", "commit", "-m", "Modify README in main"], {
        cwd: testRepoPath,
      });
      await commitMainProc.exited;

      const res = await app.request("/api/repos/repo-1/tasks/task-1/apply", {
        method: "POST",
      });
      const body: AnyJson = await res.json();

      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.affectedFiles).toContain("README.md");
      expect(body.conflictingFiles).toContain("README.md");
    });

    test("successfully applies worktree changes", async () => {
      await createTestRepo(db, "repo-1", testRepoPath);
      await createTestTask(db, "task-1", "repo-1", "changes/feat", "DONE");

      const gitManager = new GitManager({ repoPath: testRepoPath, repoId: "repo-1" });
      await gitManager.init();
      const worktreeInfo = await gitManager.createWorktree("task-1", "main");

      // Add changes to worktree
      writeFileSync(join(worktreeInfo.path, "new-file.txt"), "New content");
      const addProc = Bun.spawn(["git", "add", "."], {
        cwd: worktreeInfo.path,
      });
      await addProc.exited;
      const commitProc = Bun.spawn(["git", "commit", "-m", "Add new file"], {
        cwd: worktreeInfo.path,
      });
      await commitProc.exited;

      const res = await app.request("/api/repos/repo-1/tasks/task-1/apply", {
        method: "POST",
      });
      const body: AnyJson = await res.json();

      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.affectedFiles).toContain("new-file.txt");
    });
  });
});

describe("task/routes - resolve endpoint", () => {
  let db: Kysely<Database>;
  let ctx: LocalServerContext;
  let app: ReturnType<typeof createApp>;
  let cleanupAopHome: () => void;

  beforeEach(async () => {
    cleanupAopHome = useTestAopHome();
    db = await createTestDb();
    ctx = createCommandContext(db);
    app = createApp({ ctx, startTimeMs: Date.now() });
  });

  afterEach(async () => {
    await db.destroy();
    cleanupAopHome();
  });

  describe("GET /api/tasks/resolve/:identifier", () => {
    test("returns 404 for non-existent task by id", async () => {
      const res = await app.request("/api/tasks/resolve/non-existent");
      const body: AnyJson = await res.json();

      expect(res.status).toBe(404);
      expect(body.error).toBe("Task not found");
    });

    test("resolves task by id", async () => {
      await createTestRepo(db, "repo-1", "/path/to/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat", "DONE");

      const res = await app.request("/api/tasks/resolve/task-1");
      const body: AnyJson = await res.json();

      expect(res.status).toBe(200);
      expect(body.task).toBeDefined();
      expect(body.task.id).toBe("task-1");
      expect(body.task.repo_id).toBe("repo-1");
      expect(body.task.change_path).toBe("changes/feat");
    });
  });
});
