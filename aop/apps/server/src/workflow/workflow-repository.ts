import type { Kysely } from "kysely";
import type { Database, NewWorkflow, Workflow } from "../db/schema.ts";

export interface WorkflowRepository {
  findById: (id: string) => Promise<Workflow | null>;
  findByName: (name: string) => Promise<Workflow | null>;
  create: (workflow: NewWorkflow) => Promise<Workflow>;
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

  create: async (workflow: NewWorkflow): Promise<Workflow> => {
    return db.insertInto("workflows").values(workflow).returningAll().executeTakeFirstOrThrow();
  },
});
