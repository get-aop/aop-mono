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

  test("deactivates stale workflows not present on disk", async () => {
    await repository.create({
      id: "stale-id",
      name: "stale-workflow",
      definition: JSON.stringify({ version: 1, name: "stale-workflow", steps: {} }),
    });

    const workflows = [createWorkflowDefinition("simple")];

    const result = await syncWorkflows(repository, workflows);

    expect(result.deactivated).toBe(1);

    const stale = await repository.findByName("stale-workflow");
    expect(stale).not.toBeNull();
    expect(stale?.active).toBe(false);

    const activeNames = await repository.listNames();
    expect(activeNames).not.toContain("stale-workflow");
    expect(activeNames).toContain("simple");
  });

  test("reactivates workflow when YAML file returns", async () => {
    await repository.create({
      id: "returning-id",
      name: "returning-workflow",
      definition: JSON.stringify({ version: 1, name: "returning-workflow", steps: {} }),
    });

    await syncWorkflows(repository, []);
    const deactivated = await repository.findByName("returning-workflow");
    expect(deactivated?.active).toBe(false);

    await syncWorkflows(repository, [createWorkflowDefinition("returning-workflow")]);
    const reactivated = await repository.findByName("returning-workflow");
    expect(reactivated?.active).toBe(true);

    const activeNames = await repository.listNames();
    expect(activeNames).toContain("returning-workflow");
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
