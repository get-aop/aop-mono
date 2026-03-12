import type { Kysely } from "kysely";
import type { Database, TaskDependency, TaskSource } from "../../db/schema.ts";

const LINEAR_PROVIDER = "linear";
const LINEAR_BLOCKS_SOURCE = "linear_blocks";

export interface UpsertTaskSourceInput {
  taskId: string;
  repoId: string;
  externalId: string;
  externalRef: string;
  externalUrl: string;
  titleSnapshot: string;
}

export interface LinearStore {
  upsertTaskSource(input: UpsertTaskSourceInput): Promise<void>;
  getTaskSourceByExternalId(repoId: string, externalId: string): Promise<TaskSource | null>;
  getTaskSourceByExternalRef(repoId: string, externalRef: string): Promise<TaskSource | null>;
  replaceTaskDependencies(taskId: string, dependsOnTaskIds: string[]): Promise<void>;
  listTaskDependencies(taskId: string): Promise<TaskDependency[]>;
}

export const createLinearStore = (db: Kysely<Database>): LinearStore => ({
  upsertTaskSource: async (input: UpsertTaskSourceInput): Promise<void> => {
    const updatedAt = new Date().toISOString();

    await db.transaction().execute(async (trx) => {
      await trx
        .deleteFrom("task_sources")
        .where("task_id", "=", input.taskId)
        .where("provider", "=", LINEAR_PROVIDER)
        .where("external_id", "!=", input.externalId)
        .execute();

      await trx
        .insertInto("task_sources")
        .values({
          task_id: input.taskId,
          repo_id: input.repoId,
          provider: LINEAR_PROVIDER,
          external_id: input.externalId,
          external_ref: input.externalRef,
          external_url: input.externalUrl,
          title_snapshot: input.titleSnapshot,
          created_at: updatedAt,
          updated_at: updatedAt,
        })
        .onConflict((oc) =>
          oc.columns(["repo_id", "provider", "external_id"]).doUpdateSet({
            task_id: input.taskId,
            external_ref: input.externalRef,
            external_url: input.externalUrl,
            title_snapshot: input.titleSnapshot,
            updated_at: updatedAt,
          }),
        )
        .execute();
    });
  },

  getTaskSourceByExternalId: async (
    repoId: string,
    externalId: string,
  ): Promise<TaskSource | null> =>
    (await db
      .selectFrom("task_sources")
      .selectAll()
      .where("repo_id", "=", repoId)
      .where("provider", "=", LINEAR_PROVIDER)
      .where("external_id", "=", externalId)
      .executeTakeFirst()) ?? null,

  getTaskSourceByExternalRef: async (
    repoId: string,
    externalRef: string,
  ): Promise<TaskSource | null> =>
    (await db
      .selectFrom("task_sources")
      .selectAll()
      .where("repo_id", "=", repoId)
      .where("provider", "=", LINEAR_PROVIDER)
      .where("external_ref", "=", externalRef)
      .executeTakeFirst()) ?? null,

  replaceTaskDependencies: async (taskId: string, dependsOnTaskIds: string[]): Promise<void> => {
    const uniqueDependencyIds = [...new Set(dependsOnTaskIds)];
    if (uniqueDependencyIds.includes(taskId)) {
      throw new Error("Task cannot depend on itself");
    }

    await db.transaction().execute(async (trx) => {
      await trx.deleteFrom("task_dependencies").where("task_id", "=", taskId).execute();

      if (uniqueDependencyIds.length === 0) {
        return;
      }

      await trx
        .insertInto("task_dependencies")
        .values(
          uniqueDependencyIds.map((dependsOnTaskId) => ({
            task_id: taskId,
            depends_on_task_id: dependsOnTaskId,
            source: LINEAR_BLOCKS_SOURCE,
          })),
        )
        .execute();
    });
  },

  listTaskDependencies: async (taskId: string): Promise<TaskDependency[]> =>
    db
      .selectFrom("task_dependencies")
      .selectAll()
      .where("task_id", "=", taskId)
      .orderBy("depends_on_task_id", "asc")
      .execute(),
});
