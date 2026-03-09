import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Kysely } from "kysely";
import type { Database } from "../db/schema.ts";
import { createTestDb } from "../db/test-utils.ts";
import type { WorkflowDefinition } from "../workflow-engine/types.ts";
import { createWorkflowRepository, type WorkflowRepository } from "./repository.ts";
import { syncWorkflows } from "./sync.ts";

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

  beforeEach(async () => {
    db = await createTestDb();
    repository = createWorkflowRepository(db);
  });

  afterEach(async () => {
    await db.destroy();
  });

  test("inserts new workflows", async () => {
    const workflows = [createWorkflowDefinition("simple"), createWorkflowDefinition("advanced")];

    const result = await syncWorkflows(repository, workflows);

    expect(result).toEqual({ inserted: 2, updated: 0, deactivated: 0 });
    expect(await repository.listNames()).toEqual(["advanced", "simple"]);
  });

  test("updates existing workflows", async () => {
    await repository.create({
      id: "existing-id",
      name: "simple",
      definition: JSON.stringify({ version: 1, name: "simple", steps: {} }),
    });

    const result = await syncWorkflows(repository, [createWorkflowDefinition("simple")]);
    const simple = await repository.findByName("simple");

    expect(result).toEqual({ inserted: 0, updated: 1, deactivated: 0 });
    expect(simple?.id).toBe("existing-id");
    expect(simple?.version).toBe(2);
  });

  test("deactivates stale workflows not present on disk", async () => {
    await repository.create({
      id: "stale-id",
      name: "stale-workflow",
      definition: JSON.stringify({ version: 1, name: "stale-workflow", steps: {} }),
    });

    const result = await syncWorkflows(repository, [createWorkflowDefinition("simple")]);
    const stale = await repository.findByName("stale-workflow");

    expect(result).toEqual({ inserted: 1, updated: 0, deactivated: 1 });
    expect(stale?.active).toBe(false);
    expect(await repository.listNames()).toEqual(["simple"]);
  });
});
