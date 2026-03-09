import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { useTestAopHome } from "@aop/infra";
import { Hono } from "hono";
import type { Kysely } from "kysely";
import { createCommandContext, type LocalServerContext } from "../context.ts";
import type { Database } from "../db/schema.ts";
import { type AnyJson, createTestDb, createTestRepo, createTestTask } from "../db/test-utils.ts";
import { createRepoRoutes } from "./routes.ts";

describe("repo/routes", () => {
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

  describe("POST /api/repos", () => {
    let testRepoPath: string;

    beforeEach(async () => {
      testRepoPath = join(tmpdir(), `aop-test-repo-${Date.now()}`);
      mkdirSync(testRepoPath, { recursive: true });
    });

    afterEach(() => {
      if (existsSync(testRepoPath)) {
        rmSync(testRepoPath, { recursive: true });
      }
    });

    test("returns 400 when path is missing", async () => {
      const res = await app.request("/api/repos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const body: AnyJson = await res.json();

      expect(res.status).toBe(400);
      expect(body.error).toBe("Missing required field: path");
    });

    test("returns 400 when path is not a git repo", async () => {
      const res = await app.request("/api/repos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: testRepoPath }),
      });
      const body: AnyJson = await res.json();

      expect(res.status).toBe(400);
      expect(body.error).toBe("Not a git repository");
      expect(body.path).toBe(testRepoPath);
    });

    test("registers a new repo successfully", async () => {
      const proc = Bun.spawn(["git", "init"], { cwd: testRepoPath });
      await proc.exited;

      const res = await app.request("/api/repos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: testRepoPath }),
      });
      const body: AnyJson = await res.json();

      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.repoId).toBeDefined();
      expect(body.alreadyExists).toBe(false);
    });

    test("returns existing repo when already registered", async () => {
      const proc = Bun.spawn(["git", "init"], { cwd: testRepoPath });
      await proc.exited;

      const firstRes = await app.request("/api/repos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: testRepoPath }),
      });
      const firstBody: AnyJson = await firstRes.json();

      const secondRes = await app.request("/api/repos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: testRepoPath }),
      });
      const secondBody: AnyJson = await secondRes.json();

      expect(secondRes.status).toBe(200);
      expect(secondBody.repoId).toBe(firstBody.repoId);
      expect(secondBody.alreadyExists).toBe(true);
    });
  });

  describe("DELETE /api/repos/:id", () => {
    test("returns 404 for non-existent repo", async () => {
      const res = await app.request("/api/repos/non-existent", {
        method: "DELETE",
      });
      const body: AnyJson = await res.json();

      expect(res.status).toBe(404);
      expect(body.error).toBe("Repo not found");
    });

    test("removes repo successfully", async () => {
      await createTestRepo(db, "repo-1", "/path/to/repo");

      const res = await app.request("/api/repos/repo-1", { method: "DELETE" });
      const body: AnyJson = await res.json();

      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.repoId).toBe("repo-1");
    });

    test("returns 409 when repo has working tasks without force", async () => {
      await createTestRepo(db, "repo-1", "/path/to/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat", "WORKING");

      const res = await app.request("/api/repos/repo-1", { method: "DELETE" });
      const body: AnyJson = await res.json();

      expect(res.status).toBe(409);
      expect(body.error).toBe("Cannot remove repo with working tasks");
      expect(body.count).toBe(1);
    });
  });

  describe("GET /api/repos/:id/tasks", () => {
    test("returns 404 for non-existent repo", async () => {
      const res = await app.request("/api/repos/non-existent/tasks");
      const body: AnyJson = await res.json();

      expect(res.status).toBe(404);
      expect(body.error).toBe("Repo not found");
    });

    test("returns tasks for repo", async () => {
      await createTestRepo(db, "repo-1", "/path/to/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "DRAFT");
      await createTestTask(db, "task-2", "repo-1", "changes/feat-2", "READY");

      const res = await app.request("/api/repos/repo-1/tasks");
      const body: AnyJson = await res.json();

      expect(res.status).toBe(200);
      expect(body.tasks).toHaveLength(2);
    });

    test("excludes REMOVED tasks", async () => {
      await createTestRepo(db, "repo-1", "/path/to/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "DRAFT");
      await createTestTask(db, "task-2", "repo-1", "changes/feat-2", "REMOVED");

      const res = await app.request("/api/repos/repo-1/tasks");
      const body: AnyJson = await res.json();

      expect(body.tasks).toHaveLength(1);
      expect(body.tasks[0].id).toBe("task-1");
    });
  });
});
