import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Kysely } from "kysely";
import type { Database } from "../../db/schema.ts";
import { createTestDb, createTestRepo } from "../../db/test-utils.ts";

interface LinearStoreModule {
  createLinearStore(db: Kysely<Database>): {
    upsertTaskSource(input: {
      taskId: string;
      repoId: string;
      externalId: string;
      externalRef: string;
      externalUrl: string;
      titleSnapshot: string;
    }): Promise<void>;
    getTaskSourceByExternalId(
      repoId: string,
      externalId: string,
    ): Promise<{
      task_id: string;
      repo_id: string;
      provider: string;
      external_id: string;
      external_ref: string;
      external_url: string;
      title_snapshot: string;
    } | null>;
    getTaskSourceByExternalRef(
      repoId: string,
      externalRef: string,
    ): Promise<{
      task_id: string;
      repo_id: string;
      provider: string;
      external_id: string;
      external_ref: string;
      external_url: string;
      title_snapshot: string;
    } | null>;
    replaceTaskDependencies(taskId: string, dependsOnTaskIds: string[]): Promise<void>;
    listTaskDependencies(taskId: string): Promise<
      Array<{
        task_id: string;
        depends_on_task_id: string;
        source: string;
      }>
    >;
  };
}

const loadStoreModule = async (): Promise<LinearStoreModule> =>
  (await import("./store.ts")) as LinearStoreModule;

describe("integrations/linear/store", () => {
  let db: Kysely<Database>;

  beforeEach(async () => {
    db = await createTestDb();
    await createTestRepo(db, "repo-1", "/tmp/linear-store-repo");
  });

  afterEach(async () => {
    await db.destroy();
  });

  test("upserts a task source and resolves it by external id and ref", async () => {
    const { createLinearStore } = await loadStoreModule();
    const store = createLinearStore(db);

    await store.upsertTaskSource({
      taskId: "task-1",
      repoId: "repo-1",
      externalId: "lin_123",
      externalRef: "ABC-123",
      externalUrl: "https://linear.app/acme/issue/ABC-123/first-issue",
      titleSnapshot: "First issue",
    });

    expect(await store.getTaskSourceByExternalId("repo-1", "lin_123")).toMatchObject({
      task_id: "task-1",
      repo_id: "repo-1",
      provider: "linear",
      external_id: "lin_123",
      external_ref: "ABC-123",
      external_url: "https://linear.app/acme/issue/ABC-123/first-issue",
      title_snapshot: "First issue",
    });
    expect(await store.getTaskSourceByExternalRef("repo-1", "ABC-123")).toMatchObject({
      task_id: "task-1",
      repo_id: "repo-1",
      provider: "linear",
      external_id: "lin_123",
      external_ref: "ABC-123",
      external_url: "https://linear.app/acme/issue/ABC-123/first-issue",
      title_snapshot: "First issue",
    });
  });

  test("keeps one canonical row per repo and Linear issue id when re-imported", async () => {
    const { createLinearStore } = await loadStoreModule();
    const store = createLinearStore(db);

    await store.upsertTaskSource({
      taskId: "task-1",
      repoId: "repo-1",
      externalId: "lin_123",
      externalRef: "ABC-123",
      externalUrl: "https://linear.app/acme/issue/ABC-123/first-issue",
      titleSnapshot: "First title",
    });
    await store.upsertTaskSource({
      taskId: "task-2",
      repoId: "repo-1",
      externalId: "lin_123",
      externalRef: "ABC-123",
      externalUrl: "https://linear.app/acme/issue/ABC-123/renamed-issue",
      titleSnapshot: "Renamed title",
    });

    const rows = await db.selectFrom("task_sources").selectAll().execute();

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      task_id: "task-2",
      external_id: "lin_123",
      external_ref: "ABC-123",
      external_url: "https://linear.app/acme/issue/ABC-123/renamed-issue",
      title_snapshot: "Renamed title",
    });
  });

  test("replaces dependency edges and removes stale rows", async () => {
    const { createLinearStore } = await loadStoreModule();
    const store = createLinearStore(db);

    await store.replaceTaskDependencies("task-1", ["task-2", "task-3", "task-2"]);
    expect(await store.listTaskDependencies("task-1")).toMatchObject([
      {
        task_id: "task-1",
        depends_on_task_id: "task-2",
        source: "linear_blocks",
      },
      {
        task_id: "task-1",
        depends_on_task_id: "task-3",
        source: "linear_blocks",
      },
    ]);

    await store.replaceTaskDependencies("task-1", ["task-3"]);
    expect(await store.listTaskDependencies("task-1")).toMatchObject([
      {
        task_id: "task-1",
        depends_on_task_id: "task-3",
        source: "linear_blocks",
      },
    ]);
  });

  test("rejects self-dependencies", async () => {
    const { createLinearStore } = await loadStoreModule();
    const store = createLinearStore(db);

    await expect(store.replaceTaskDependencies("task-1", ["task-1"])).rejects.toThrow(
      "Task cannot depend on itself",
    );
  });
});
