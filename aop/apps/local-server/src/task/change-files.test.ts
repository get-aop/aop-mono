import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { aopPaths } from "@aop/infra";
import { Hono } from "hono";
import type { Kysely } from "kysely";
import { createCommandContext, type LocalServerContext } from "../context.ts";
import type { Database } from "../db/schema.ts";
import { type AnyJson, createTestDb, createTestRepo } from "../db/test-utils.ts";
import { createRepoRoutes } from "../repo/routes.ts";

describe("task/change-files", () => {
  let db: Kysely<Database>;
  let ctx: LocalServerContext;
  let app: Hono;

  const repoId = "repo-cf";
  const changePath = "docs/tasks/test-change";
  const changeDir = () => join(aopPaths.repoDir(repoId), changePath);
  const createRuntimeTask = async () =>
    ctx.taskRepository.createIdempotent({
      id: "task-change-files",
      repo_id: repoId,
      change_path: changePath,
      status: "DRAFT",
    });

  beforeEach(async () => {
    db = await createTestDb();
    ctx = createCommandContext(db);
    app = new Hono();
    app.route("/api/repos", createRepoRoutes(ctx));
    await createTestRepo(db, repoId, aopPaths.repoDir(repoId));
  });

  afterEach(async () => {
    await db.destroy();
    rmSync(aopPaths.repoDir(repoId), { recursive: true, force: true });
  });

  describe("GET /api/repos/:repoId/tasks/:taskId/files", () => {
    test("lists markdown files in change directory", async () => {
      const task = await createRuntimeTask();
      expect(task).toBeTruthy();
      const dir = changeDir();
      writeFileSync(join(dir, "plan.md"), "# Plan");
      writeFileSync(join(dir, "001-first-step.md"), "# First step");

      const res = await app.request(`/api/repos/${repoId}/tasks/${task?.id}/files`);
      const body: AnyJson = await res.json();

      expect(res.status).toBe(200);
      expect(body.files).toBeArray();
      expect(body.files).toContain("task.md");
      expect(body.files).toContain("plan.md");
      expect(body.files).toContain("001-first-step.md");
    });

    test("lists nested directory files with relative paths", async () => {
      const task = await createRuntimeTask();
      expect(task).toBeTruthy();
      const dir = changeDir();
      mkdirSync(join(dir, "specs"), { recursive: true });
      writeFileSync(join(dir, "specs/api.md"), "# API Spec");

      const res = await app.request(`/api/repos/${repoId}/tasks/${task?.id}/files`);
      const body: AnyJson = await res.json();

      expect(res.status).toBe(200);
      expect(body.files).toContain("task.md");
      expect(body.files).toContain("specs/api.md");
    });

    test("returns scaffolded task.md when no extra markdown files exist", async () => {
      const task = await createRuntimeTask();
      expect(task).toBeTruthy();

      const res = await app.request(`/api/repos/${repoId}/tasks/${task?.id}/files`);
      const body: AnyJson = await res.json();

      expect(res.status).toBe(200);
      expect(body.files).toEqual(["task.md"]);
    });

    test("returns 404 for non-existent task", async () => {
      const res = await app.request(`/api/repos/${repoId}/tasks/non-existent/files`);
      const body: AnyJson = await res.json();

      expect(res.status).toBe(404);
      expect(body.error).toBe("Task not found");
    });

    test("returns scaffolded task.md after task creation", async () => {
      const task = await createRuntimeTask();
      expect(task).toBeTruthy();

      const res = await app.request(`/api/repos/${repoId}/tasks/${task?.id}/files`);
      const body: AnyJson = await res.json();

      expect(res.status).toBe(200);
      expect(body.files).toEqual(["task.md"]);
    });
  });

  describe("GET /api/repos/:repoId/tasks/:taskId/files/:path", () => {
    test("returns file content for valid path", async () => {
      const task = await createRuntimeTask();
      expect(task).toBeTruthy();

      const res = await app.request(`/api/repos/${repoId}/tasks/${task?.id}/files/task.md`);
      const body: AnyJson = await res.json();

      expect(res.status).toBe(200);
      expect(body.content).toContain("## Description");
    });

    test("returns nested file content", async () => {
      const task = await createRuntimeTask();
      expect(task).toBeTruthy();
      const dir = changeDir();
      mkdirSync(join(dir, "specs"), { recursive: true });
      writeFileSync(join(dir, "specs/api.md"), "# API");

      const res = await app.request(`/api/repos/${repoId}/tasks/${task?.id}/files/specs/api.md`);
      const body: AnyJson = await res.json();

      expect(res.status).toBe(200);
      expect(body.content).toBe("# API");
    });

    test("returns 404 for non-existent file", async () => {
      const task = await createRuntimeTask();
      expect(task).toBeTruthy();
      mkdirSync(changeDir(), { recursive: true });

      const res = await app.request(`/api/repos/${repoId}/tasks/${task?.id}/files/missing.md`);
      const body: AnyJson = await res.json();

      expect(res.status).toBe(404);
      expect(body.error).toBe("File not found");
    });

    test("rejects path with .. segment via validation", async () => {
      // URL parsers normalize `..` before reaching handlers, but isValidMdPath
      // provides defense-in-depth. Test the validation directly:
      const { isValidMdPath } = await import("./change-files.ts");
      expect(isValidMdPath("../secrets.md", "/some/dir")).toBe(false);
      expect(isValidMdPath("sub/../../secrets.md", "/some/dir")).toBe(false);
      expect(isValidMdPath("valid.md", "/some/dir")).toBe(true);
    });

    test("returns 400 for non-md extension", async () => {
      const task = await createRuntimeTask();
      expect(task).toBeTruthy();
      mkdirSync(changeDir(), { recursive: true });

      const res = await app.request(`/api/repos/${repoId}/tasks/${task?.id}/files/config.json`);
      const body: AnyJson = await res.json();

      expect(res.status).toBe(400);
      expect(body.error).toBe("Invalid file path");
    });

    test("returns 404 for non-existent task", async () => {
      const res = await app.request(`/api/repos/${repoId}/tasks/non-existent/files/task.md`);
      const body: AnyJson = await res.json();

      expect(res.status).toBe(404);
      expect(body.error).toBe("Task not found");
    });
  });
});
