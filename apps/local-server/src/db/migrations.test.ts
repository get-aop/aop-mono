import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Kysely } from "kysely";
import { sql } from "kysely";
import { createDatabase } from "./connection.ts";
import { runMigrations } from "./migrations.ts";
import type { Database } from "./schema.ts";

describe("db/migrations", () => {
  let db: Kysely<Database>;

  beforeEach(() => {
    db = createDatabase(":memory:");
  });

  afterEach(async () => {
    await db.destroy();
  });

  test("creates Linear linkage tables in the current bootstrap flow", async () => {
    await runMigrations(db);

    const tables = await sql<{ name: string }>`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table'
        AND name IN ('task_sources', 'task_dependencies')
    `.execute(db);

    expect(tables.rows.map((table) => table.name).sort()).toEqual([
      "task_dependencies",
      "task_sources",
    ]);
  });

  test("allows linkage rows without a tasks table foreign key", async () => {
    await runMigrations(db);
    await db
      .insertInto("repos")
      .values({
        id: "repo-1",
        path: "/tmp/migrations-test-repo",
        name: "migrations-test-repo",
        remote_origin: null,
        max_concurrent_tasks: 1,
      })
      .execute();

    await db
      .insertInto("task_sources")
      .values({
        task_id: "task-1",
        repo_id: "repo-1",
        provider: "linear",
        external_id: "lin_123",
        external_ref: "ABC-123",
        external_url: "https://linear.app/acme/issue/ABC-123/first-issue",
        title_snapshot: "First issue",
      })
      .execute();
    await db
      .insertInto("task_dependencies")
      .values({
        task_id: "task-1",
        depends_on_task_id: "task-2",
        source: "linear_blocks",
      })
      .execute();

    expect(await db.selectFrom("task_sources").selectAll().execute()).toHaveLength(1);
    expect(await db.selectFrom("task_dependencies").selectAll().execute()).toHaveLength(1);
  });
});
