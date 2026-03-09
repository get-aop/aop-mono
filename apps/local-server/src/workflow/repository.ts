import { createCrudHelpers } from "@aop/infra";
import type { Kysely } from "kysely";
import type { Database, NewWorkflow, Workflow } from "../db/schema.ts";

export interface WorkflowRepository {
  findById: (id: string) => Promise<Workflow | null>;
  findByName: (name: string) => Promise<Workflow | null>;
  listNames: () => Promise<string[]>;
  listAllNames: () => Promise<string[]>;
  create: (workflow: NewWorkflow) => Promise<Workflow>;
  upsert: (workflow: NewWorkflow) => Promise<Workflow>;
  deactivateByName: (name: string) => Promise<boolean>;
}

const normalizeWorkflow = (workflow: Workflow): Workflow => ({
  ...workflow,
  version: Number(workflow.version),
  active: Boolean(workflow.active),
});

export const createWorkflowRepository = (db: Kysely<Database>): WorkflowRepository => {
  const { findById, create } = createCrudHelpers(db, "workflows");

  return {
    findById: async (id: string): Promise<Workflow | null> => {
      const workflow = await findById(id);
      return workflow ? normalizeWorkflow(workflow) : null;
    },

    findByName: async (name: string): Promise<Workflow | null> => {
      const workflow = await db
        .selectFrom("workflows")
        .selectAll()
        .where("name", "=", name)
        .executeTakeFirst();
      return workflow ? normalizeWorkflow(workflow) : null;
    },

    listNames: async (): Promise<string[]> => {
      const rows = await db
        .selectFrom("workflows")
        .select("name")
        .where("active", "=", true)
        .orderBy("name")
        .execute();
      return rows.map((row) => row.name);
    },

    listAllNames: async (): Promise<string[]> => {
      const rows = await db.selectFrom("workflows").select("name").orderBy("name").execute();
      return rows.map((row) => row.name);
    },

    create: async (workflow: NewWorkflow): Promise<Workflow> =>
      normalizeWorkflow(await create(workflow)),

    upsert: async (workflow: NewWorkflow): Promise<Workflow> => {
      const existing = await db
        .selectFrom("workflows")
        .selectAll()
        .where("name", "=", workflow.name)
        .executeTakeFirst();

      if (existing) {
        return normalizeWorkflow(
          await db
            .updateTable("workflows")
            .set({
              definition: workflow.definition,
              version: existing.version + 1,
              active: true,
            })
            .where("id", "=", existing.id)
            .returningAll()
            .executeTakeFirstOrThrow(),
        );
      }

      return normalizeWorkflow(await create(workflow));
    },

    deactivateByName: async (name: string): Promise<boolean> => {
      const existing = await db
        .selectFrom("workflows")
        .select(["id", "active"])
        .where("name", "=", name)
        .executeTakeFirst();

      if (!existing || !existing.active) {
        return false;
      }

      await db
        .updateTable("workflows")
        .set({ active: false })
        .where("id", "=", existing.id)
        .execute();
      return true;
    },
  };
};
