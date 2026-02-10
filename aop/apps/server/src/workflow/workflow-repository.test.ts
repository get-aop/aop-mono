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

  describe("listNames", () => {
    test("returns empty array when no workflows exist", async () => {
      const names = await repository.listNames();

      expect(names).toEqual([]);
    });

    test("returns workflow names in alphabetical order", async () => {
      await repository.create({ id: "w-1", name: "zeta-workflow", definition: "{}" });
      await repository.create({ id: "w-2", name: "alpha-workflow", definition: "{}" });
      await repository.create({ id: "w-3", name: "mid-workflow", definition: "{}" });

      const names = await repository.listNames();

      expect(names).toEqual(["alpha-workflow", "mid-workflow", "zeta-workflow"]);
    });
  });

  describe("listNames (active filter)", () => {
    test("excludes inactive workflows", async () => {
      await repository.create({ id: "w-1", name: "active-wf", definition: "{}" });
      await repository.create({ id: "w-2", name: "inactive-wf", definition: "{}" });
      await repository.deactivateByName("inactive-wf");

      const names = await repository.listNames();

      expect(names).toContain("active-wf");
      expect(names).not.toContain("inactive-wf");
    });
  });

  describe("listAllNames", () => {
    test("includes inactive workflows", async () => {
      await repository.create({ id: "w-1", name: "active-wf", definition: "{}" });
      await repository.create({ id: "w-2", name: "inactive-wf", definition: "{}" });
      await repository.deactivateByName("inactive-wf");

      const names = await repository.listAllNames();

      expect(names).toContain("active-wf");
      expect(names).toContain("inactive-wf");
    });
  });

  describe("deactivateByName", () => {
    test("deactivates an existing workflow and returns true", async () => {
      await repository.create({ id: "w-1", name: "to-deactivate", definition: "{}" });

      const result = await repository.deactivateByName("to-deactivate");

      expect(result).toBe(true);

      const workflow = await repository.findByName("to-deactivate");
      expect(workflow).not.toBeNull();
      expect(workflow?.active).toBe(false);
    });

    test("returns false for non-existent workflow", async () => {
      const result = await repository.deactivateByName("non-existent");

      expect(result).toBe(false);
    });

    test("returns false for already inactive workflow", async () => {
      await repository.create({ id: "w-1", name: "already-inactive", definition: "{}" });
      await repository.deactivateByName("already-inactive");

      const result = await repository.deactivateByName("already-inactive");

      expect(result).toBe(false);
    });
  });

  describe("upsert", () => {
    test("inserts new workflow when name does not exist", async () => {
      const workflow = await repository.upsert({
        id: "workflow-1",
        name: "new-workflow",
        definition: JSON.stringify({ steps: [] }),
      });

      expect(workflow.id).toBe("workflow-1");
      expect(workflow.name).toBe("new-workflow");
      expect(workflow.version).toBe(1);
    });

    test("updates existing workflow and increments version", async () => {
      await repository.create({
        id: "workflow-1",
        name: "existing-workflow",
        definition: JSON.stringify({ steps: [] }),
      });

      const updated = await repository.upsert({
        id: "workflow-2",
        name: "existing-workflow",
        definition: JSON.stringify({ steps: [{ type: "implement" }] }),
      });

      expect(updated.id).toBe("workflow-1");
      expect(updated.name).toBe("existing-workflow");
      expect(updated.definition).toBe(JSON.stringify({ steps: [{ type: "implement" }] }));
      expect(updated.version).toBe(2);
    });

    test("increments version on each update", async () => {
      await repository.create({
        id: "workflow-1",
        name: "versioned-workflow",
        definition: "{}",
      });

      await repository.upsert({
        id: "any",
        name: "versioned-workflow",
        definition: JSON.stringify({ v: 2 }),
      });

      const third = await repository.upsert({
        id: "any",
        name: "versioned-workflow",
        definition: JSON.stringify({ v: 3 }),
      });

      expect(third.version).toBe(3);
      expect(third.definition).toBe(JSON.stringify({ v: 3 }));
    });
  });
});
