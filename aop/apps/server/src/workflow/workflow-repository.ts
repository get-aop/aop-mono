import type { Kysely } from "kysely";
import type { Database, NewWorkflow, Workflow } from "../db/schema.ts";

export interface WorkflowRepository {
  findById: (id: string) => Promise<Workflow | null>;
  findByName: (name: string) => Promise<Workflow | null>;
  listNames: () => Promise<string[]>;
  create: (workflow: NewWorkflow) => Promise<Workflow>;
  upsert: (workflow: NewWorkflow) => Promise<Workflow>;
}

export const createWorkflowRepository = (db: Kysely<Database>): WorkflowRepository => ({
  findById: async (id: string): Promise<Workflow | null> => {
    const workflow = await db
      .selectFrom("workflows")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();
    return workflow ?? null;
  },

  findByName: async (name: string): Promise<Workflow | null> => {
    const workflow = await db
      .selectFrom("workflows")
      .selectAll()
      .where("name", "=", name)
      .executeTakeFirst();
    return workflow ?? null;
  },

  listNames: async (): Promise<string[]> => {
    const rows = await db.selectFrom("workflows").select("name").orderBy("name").execute();
    return rows.map((r) => r.name);
  },

  create: async (workflow: NewWorkflow): Promise<Workflow> => {
    return db.insertInto("workflows").values(workflow).returningAll().executeTakeFirstOrThrow();
  },

  upsert: async (workflow: NewWorkflow): Promise<Workflow> => {
    const existing = await db
      .selectFrom("workflows")
      .selectAll()
      .where("name", "=", workflow.name)
      .executeTakeFirst();

    if (existing) {
      return db
        .updateTable("workflows")
        .set({
          definition: workflow.definition,
          version: existing.version + 1,
        })
        .where("id", "=", existing.id)
        .returningAll()
        .executeTakeFirstOrThrow();
    }

    return db.insertInto("workflows").values(workflow).returningAll().executeTakeFirstOrThrow();
  },
});
