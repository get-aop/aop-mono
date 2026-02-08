import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { aopPaths } from "@aop/infra";
import { Hono } from "hono";
import type { Kysely } from "kysely";
import { createCommandContext, type LocalServerContext } from "../context.ts";
import type { Database } from "../db/schema.ts";
import { type AnyJson, createTestDb, createTestRepo, createTestTask } from "../db/test-utils.ts";
import { createRepoRoutes } from "../repo/routes.ts";

describe("task/change-files", () => {
  let db: Kysely<Database>;
  let ctx: LocalServerContext;
  let app: Hono;

  const repoId = "repo-cf";
  const changePath = "openspec/changes/test-change";
  const changeDir = () => join(aopPaths.repoDir(repoId), changePath);

  beforeEach(async () => {
    db = await createTestDb();
    ctx = createCommandContext(db);
    app = new Hono();
    app.route("/api/repos", createRepoRoutes(ctx));
    await createTestRepo(db, repoId, "/path/to/repo");
  });

  afterEach(async () => {
    await db.destroy();
    rmSync(aopPaths.repoDir(repoId), { recursive: true, force: true });
  });

  describe("GET /api/repos/:repoId/tasks/:taskId/files", () => {
    test("lists markdown files in change directory", async () => {
      await createTestTask(db, "task-1", repoId, changePath, "DRAFT");
      const dir = changeDir();
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "tasks.md"), "# Tasks");
      writeFileSync(join(dir, "design.md"), "# Design");
      writeFileSync(join(dir, "proposal.md"), "# Proposal");

      const res = await app.request(`/api/repos/${repoId}/tasks/task-1/files`);
      const body: AnyJson = await res.json();

      expect(res.status).toBe(200);
      expect(body.files).toBeArray();
      expect(body.files).toContain("tasks.md");
      expect(body.files).toContain("design.md");
      expect(body.files).toContain("proposal.md");
    });

    test("lists nested directory files with relative paths", async () => {
      await createTestTask(db, "task-1", repoId, changePath, "DRAFT");
      const dir = changeDir();
      mkdirSync(join(dir, "specs"), { recursive: true });
      writeFileSync(join(dir, "tasks.md"), "# Tasks");
      writeFileSync(join(dir, "specs/api.md"), "# API Spec");

      const res = await app.request(`/api/repos/${repoId}/tasks/task-1/files`);
      const body: AnyJson = await res.json();

      expect(res.status).toBe(200);
      expect(body.files).toContain("tasks.md");
      expect(body.files).toContain("specs/api.md");
    });

    test("returns empty array for directory with no markdown files", async () => {
      await createTestTask(db, "task-1", repoId, changePath, "DRAFT");
      mkdirSync(changeDir(), { recursive: true });

      const res = await app.request(`/api/repos/${repoId}/tasks/task-1/files`);
      const body: AnyJson = await res.json();

      expect(res.status).toBe(200);
      expect(body.files).toEqual([]);
    });

    test("returns 404 for non-existent task", async () => {
      const res = await app.request(`/api/repos/${repoId}/tasks/non-existent/files`);
      const body: AnyJson = await res.json();

      expect(res.status).toBe(404);
      expect(body.error).toBe("Task not found");
    });

    test("returns empty array when change directory does not exist", async () => {
      await createTestTask(db, "task-1", repoId, changePath, "DRAFT");

      const res = await app.request(`/api/repos/${repoId}/tasks/task-1/files`);
      const body: AnyJson = await res.json();

      expect(res.status).toBe(200);
      expect(body.files).toEqual([]);
    });
  });

  describe("GET /api/repos/:repoId/tasks/:taskId/files/:path", () => {
    test("returns file content for valid path", async () => {
      await createTestTask(db, "task-1", repoId, changePath, "DRAFT");
      const dir = changeDir();
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "tasks.md"), "# Tasks\n- [ ] Task 1");

      const res = await app.request(`/api/repos/${repoId}/tasks/task-1/files/tasks.md`);
      const body: AnyJson = await res.json();

      expect(res.status).toBe(200);
      expect(body.content).toBe("# Tasks\n- [ ] Task 1");
    });

    test("returns nested file content", async () => {
      await createTestTask(db, "task-1", repoId, changePath, "DRAFT");
      const dir = changeDir();
      mkdirSync(join(dir, "specs"), { recursive: true });
      writeFileSync(join(dir, "specs/api.md"), "# API");

      const res = await app.request(`/api/repos/${repoId}/tasks/task-1/files/specs/api.md`);
      const body: AnyJson = await res.json();

      expect(res.status).toBe(200);
      expect(body.content).toBe("# API");
    });

    test("returns 404 for non-existent file", async () => {
      await createTestTask(db, "task-1", repoId, changePath, "DRAFT");
      mkdirSync(changeDir(), { recursive: true });

      const res = await app.request(`/api/repos/${repoId}/tasks/task-1/files/missing.md`);
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
      await createTestTask(db, "task-1", repoId, changePath, "DRAFT");
      mkdirSync(changeDir(), { recursive: true });

      const res = await app.request(`/api/repos/${repoId}/tasks/task-1/files/config.json`);
      const body: AnyJson = await res.json();

      expect(res.status).toBe(400);
      expect(body.error).toBe("Invalid file path");
    });

    test("returns 404 for non-existent task", async () => {
      const res = await app.request(`/api/repos/${repoId}/tasks/non-existent/files/tasks.md`);
      const body: AnyJson = await res.json();

      expect(res.status).toBe(404);
      expect(body.error).toBe("Task not found");
    });
  });
});
