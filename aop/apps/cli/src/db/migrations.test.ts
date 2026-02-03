import { afterEach, describe, expect, test } from "bun:test";
import type { Kysely } from "kysely";
import { sql } from "kysely";
import { createDatabase } from "./connection.ts";
import { runMigrations } from "./migrations.ts";
import type { Database } from "./schema.ts";

describe("migrations", () => {
  let db: Kysely<Database>;

  afterEach(async () => {
    if (db) {
      await db.destroy();
    }
  });

  describe("runMigrations", () => {
    test("creates all required tables", async () => {
      db = createDatabase(":memory:");
      await runMigrations(db);

      const tables = await sql<{ name: string }>`
        SELECT name FROM sqlite_master
        WHERE type='table' AND name NOT LIKE 'sqlite_%'
        ORDER BY name
      `.execute(db);

      const tableNames = tables.rows.map((t) => t.name);
      expect(tableNames).toContain("settings");
      expect(tableNames).toContain("repos");
      expect(tableNames).toContain("tasks");
      expect(tableNames).toContain("executions");
      expect(tableNames).toContain("step_executions");
    });

    test("inserts default settings", async () => {
      db = createDatabase(":memory:");
      await runMigrations(db);

      const settings = await db.selectFrom("settings").selectAll().execute();

      expect(settings).toHaveLength(6);

      const settingsMap = Object.fromEntries(settings.map((s) => [s.key, s.value]));
      expect(settingsMap.max_concurrent_tasks).toBe("1");
      expect(settingsMap.watcher_poll_interval_secs).toBe("30");
      expect(settingsMap.queue_poll_interval_secs).toBe("1");
      expect(settingsMap.agent_timeout_secs).toBe("1800");
      expect(settingsMap.server_url).toBe("");
      expect(settingsMap.api_key).toBe("");
    });

    test("is idempotent - running twice does not fail", async () => {
      db = createDatabase(":memory:");
      await runMigrations(db);
      await runMigrations(db);

      const settings = await db.selectFrom("settings").selectAll().execute();
      expect(settings).toHaveLength(6);
    });

    test("creates repos table with correct schema", async () => {
      db = createDatabase(":memory:");
      await runMigrations(db);

      await db
        .insertInto("repos")
        .values({
          id: "repo-1",
          path: "/home/user/project",
          name: "project",
          remote_origin: "git@github.com:user/project.git",
        })
        .execute();

      const repo = await db
        .selectFrom("repos")
        .selectAll()
        .where("id", "=", "repo-1")
        .executeTakeFirst();

      expect(repo?.id).toBe("repo-1");
      expect(repo?.path).toBe("/home/user/project");
      expect(repo?.name).toBe("project");
      expect(repo?.remote_origin).toBe("git@github.com:user/project.git");
      expect(repo?.max_concurrent_tasks).toBe(1);
      expect(repo?.created_at).toBeDefined();
      expect(repo?.updated_at).toBeDefined();
    });

    test("creates tasks table with repo_id FK", async () => {
      db = createDatabase(":memory:");
      await runMigrations(db);

      await db.insertInto("repos").values({ id: "repo-1", path: "/home/user/project" }).execute();

      await db
        .insertInto("tasks")
        .values({
          id: "task-1",
          repo_id: "repo-1",
          change_path: "openspec/changes/add-auth",
          status: "DRAFT",
        })
        .execute();

      const task = await db
        .selectFrom("tasks")
        .selectAll()
        .where("id", "=", "task-1")
        .executeTakeFirst();

      expect(task?.repo_id).toBe("repo-1");
      expect(task?.ready_at).toBeNull();
    });

    test("creates executions table with task_id FK", async () => {
      db = createDatabase(":memory:");
      await runMigrations(db);

      await db.insertInto("repos").values({ id: "repo-1", path: "/home/user/project" }).execute();
      await db
        .insertInto("tasks")
        .values({
          id: "task-1",
          repo_id: "repo-1",
          change_path: "add-auth",
          status: "WORKING",
        })
        .execute();

      await db
        .insertInto("executions")
        .values({
          id: "exec-1",
          task_id: "task-1",
          status: "running",
          started_at: new Date().toISOString(),
        })
        .execute();

      const exec = await db
        .selectFrom("executions")
        .selectAll()
        .where("id", "=", "exec-1")
        .executeTakeFirst();

      expect(exec?.task_id).toBe("task-1");
      expect(exec?.status).toBe("running");
    });

    test("creates step_executions table with execution_id FK", async () => {
      db = createDatabase(":memory:");
      await runMigrations(db);

      await db.insertInto("repos").values({ id: "repo-1", path: "/home/user/project" }).execute();
      await db
        .insertInto("tasks")
        .values({
          id: "task-1",
          repo_id: "repo-1",
          change_path: "add-auth",
          status: "WORKING",
        })
        .execute();
      await db
        .insertInto("executions")
        .values({
          id: "exec-1",
          task_id: "task-1",
          status: "running",
          started_at: new Date().toISOString(),
        })
        .execute();

      await db
        .insertInto("step_executions")
        .values({
          id: "step-1",
          execution_id: "exec-1",
          status: "running",
          agent_pid: 12345,
          started_at: new Date().toISOString(),
        })
        .execute();

      const step = await db
        .selectFrom("step_executions")
        .selectAll()
        .where("id", "=", "step-1")
        .executeTakeFirst();

      expect(step?.execution_id).toBe("exec-1");
      expect(step?.agent_pid).toBe(12345);
      expect(step?.status).toBe("running");
    });

    test("enforces unique constraint on repo path", async () => {
      db = createDatabase(":memory:");
      await runMigrations(db);

      await db.insertInto("repos").values({ id: "repo-1", path: "/home/user/project" }).execute();

      await expect(
        db.insertInto("repos").values({ id: "repo-2", path: "/home/user/project" }).execute(),
      ).rejects.toThrow();
    });

    test("enforces unique constraint on repo_id + change_path", async () => {
      db = createDatabase(":memory:");
      await runMigrations(db);

      await db.insertInto("repos").values({ id: "repo-1", path: "/home/user/project" }).execute();
      await db
        .insertInto("tasks")
        .values({
          id: "task-1",
          repo_id: "repo-1",
          change_path: "add-auth",
          status: "DRAFT",
        })
        .execute();

      await expect(
        db
          .insertInto("tasks")
          .values({
            id: "task-2",
            repo_id: "repo-1",
            change_path: "add-auth",
            status: "DRAFT",
          })
          .execute(),
      ).rejects.toThrow();
    });

    test("creates tasks table with sync columns (remote_id, synced_at)", async () => {
      db = createDatabase(":memory:");
      await runMigrations(db);

      await db.insertInto("repos").values({ id: "repo-1", path: "/home/user/project" }).execute();

      await db
        .insertInto("tasks")
        .values({
          id: "task-1",
          repo_id: "repo-1",
          change_path: "openspec/changes/add-auth",
          status: "DRAFT",
          remote_id: "remote_abc123",
          synced_at: "2026-02-02T10:00:00Z",
        })
        .execute();

      const task = await db
        .selectFrom("tasks")
        .selectAll()
        .where("id", "=", "task-1")
        .executeTakeFirst();

      expect(task?.remote_id).toBe("remote_abc123");
      expect(task?.synced_at).toBe("2026-02-02T10:00:00Z");
    });

    test("sync columns default to null", async () => {
      db = createDatabase(":memory:");
      await runMigrations(db);

      await db.insertInto("repos").values({ id: "repo-1", path: "/home/user/project" }).execute();

      await db
        .insertInto("tasks")
        .values({
          id: "task-1",
          repo_id: "repo-1",
          change_path: "openspec/changes/add-auth",
          status: "DRAFT",
        })
        .execute();

      const task = await db
        .selectFrom("tasks")
        .selectAll()
        .where("id", "=", "task-1")
        .executeTakeFirst();

      expect(task?.remote_id).toBeNull();
      expect(task?.synced_at).toBeNull();
    });
  });
});
