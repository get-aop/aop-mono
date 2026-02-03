import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import type { Kysely } from "kysely";
import type { Database } from "../db/schema.ts";
import { cleanupTestDb, createTestDb } from "../db/test-utils.ts";
import { createWorkflowRepository, type WorkflowRepository } from "./workflow-repository.ts";

describe("WorkflowRepository", () => {
  let db: Kysely<Database>;
  let repository: WorkflowRepository;

  beforeAll(async () => {
    db = await createTestDb();
    repository = createWorkflowRepository(db);
  });

  afterEach(async () => {
    await cleanupTestDb(db);
  });

  afterAll(async () => {
    await db.destroy();
  });

  describe("create", () => {
    test("creates a new workflow", async () => {
      const workflow = await repository.create({
        id: "workflow-1",
        name: "simple",
        definition: JSON.stringify({ steps: [{ type: "implement" }] }),
      });

      expect(workflow.id).toBe("workflow-1");
      expect(workflow.name).toBe("simple");
      expect(workflow.definition).toBe(JSON.stringify({ steps: [{ type: "implement" }] }));
      expect(workflow.version).toBe(1);
      expect(workflow.created_at).toBeDefined();
    });
  });

  describe("findById", () => {
    test("returns workflow by ID", async () => {
      await repository.create({
        id: "workflow-1",
        name: "simple",
        definition: "{}",
      });

      const workflow = await repository.findById("workflow-1");

      expect(workflow).not.toBeNull();
      expect(workflow?.name).toBe("simple");
    });

    test("returns null for non-existent ID", async () => {
      const workflow = await repository.findById("non-existent");

      expect(workflow).toBeNull();
    });
  });

  describe("findByName", () => {
    test("returns workflow by name", async () => {
      await repository.create({
        id: "workflow-1",
        name: "tdd-workflow",
        definition: "{}",
      });

      const workflow = await repository.findByName("tdd-workflow");

      expect(workflow).not.toBeNull();
      expect(workflow?.id).toBe("workflow-1");
    });

    test("returns null for non-existent name", async () => {
      const workflow = await repository.findByName("non-existent");

      expect(workflow).toBeNull();
    });
  });
});
