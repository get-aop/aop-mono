import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import type { Kysely } from "kysely";
import type { Database } from "../db/schema.ts";
import { cleanupTestDb, createTestDb } from "../db/test-utils.ts";
import type { WorkflowDefinition } from "./types.ts";
import { createWorkflowRepository, type WorkflowRepository } from "./workflow-repository.ts";
import { syncWorkflows } from "./workflow-sync.ts";

const createWorkflowDefinition = (name: string): WorkflowDefinition => ({
  version: 1,
  name,
  initialStep: "implement",
  steps: {
    implement: {
      id: "implement",
      type: "implement",
      promptTemplate: "implement.md.hbs",
      maxAttempts: 1,
      transitions: [
        { condition: "success", target: "__done__" },
        { condition: "failure", target: "__blocked__" },
      ],
    },
  },
  terminalStates: ["__done__", "__blocked__"],
});

describe("syncWorkflows", () => {
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

  test("inserts new workflows", async () => {
    const workflows = [createWorkflowDefinition("simple"), createWorkflowDefinition("advanced")];

    const result = await syncWorkflows(repository, workflows);

    expect(result.inserted).toBe(2);
    expect(result.updated).toBe(0);

    const simple = await repository.findByName("simple");
    expect(simple).not.toBeNull();
    expect(simple?.version).toBe(1);

    const advanced = await repository.findByName("advanced");
    expect(advanced).not.toBeNull();
    expect(advanced?.version).toBe(1);
  });

  test("updates existing workflows", async () => {
    await repository.create({
      id: "existing-id",
      name: "simple",
      definition: JSON.stringify({ version: 1, name: "simple", steps: {} }),
    });

    const workflows = [createWorkflowDefinition("simple")];

    const result = await syncWorkflows(repository, workflows);

    expect(result.inserted).toBe(0);
    expect(result.updated).toBe(1);

    const simple = await repository.findByName("simple");
    expect(simple?.id).toBe("existing-id");
    expect(simple?.version).toBe(2);
  });

  test("preserves database-only workflows", async () => {
    await repository.create({
      id: "db-only-id",
      name: "db-only-workflow",
      definition: JSON.stringify({ version: 1, name: "db-only-workflow", steps: {} }),
    });

    const workflows = [createWorkflowDefinition("simple")];

    await syncWorkflows(repository, workflows);

    const dbOnly = await repository.findByName("db-only-workflow");
    expect(dbOnly).not.toBeNull();
    expect(dbOnly?.id).toBe("db-only-id");
  });

  test("handles mix of inserts and updates", async () => {
    await repository.create({
      id: "existing-id",
      name: "existing",
      definition: JSON.stringify({ version: 1, name: "existing", steps: {} }),
    });

    const workflows = [createWorkflowDefinition("existing"), createWorkflowDefinition("new-one")];

    const result = await syncWorkflows(repository, workflows);

    expect(result.inserted).toBe(1);
    expect(result.updated).toBe(1);
  });

  test("handles empty workflow list", async () => {
    const result = await syncWorkflows(repository, []);

    expect(result.inserted).toBe(0);
    expect(result.updated).toBe(0);
  });
});
