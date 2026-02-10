import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { Kysely } from "kysely";
import type { Database } from "../db/schema.ts";
import { cleanupTestDb, createTestDb } from "../db/test-utils.ts";
import { loadWorkflowsFromDirectory } from "./workflow-loader.ts";
import { createWorkflowRepository, type WorkflowRepository } from "./workflow-repository.ts";
import { syncWorkflows } from "./workflow-sync.ts";

describe("workflow startup sync integration", () => {
  let db: Kysely<Database>;
  let repository: WorkflowRepository;
  const workflowsDir = join(import.meta.dirname, "..", "..", "workflows");

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

  test("syncs YAML workflows to database at startup", async () => {
    const workflows = await loadWorkflowsFromDirectory(workflowsDir);
    const result = await syncWorkflows(repository, workflows);

    expect(result.inserted).toBe(6);
    expect(result.updated).toBe(0);

    const simple = await repository.findByName("simple");
    expect(simple).not.toBeNull();
    expect(simple?.name).toBe("simple");

    if (!simple) throw new Error("Expected simple workflow to exist");
    const simpleDefinition = JSON.parse(simple.definition);
    expect(simpleDefinition.version).toBe(1);
    expect(simpleDefinition.initialStep).toBe("implement");
    expect(simpleDefinition.steps.implement.type).toBe("implement");

    const aopDefault = await repository.findByName("aop-default");
    expect(aopDefault).not.toBeNull();
    expect(aopDefault?.name).toBe("aop-default");

    if (!aopDefault) throw new Error("Expected aop-default workflow to exist");
    const aopDefinition = JSON.parse(aopDefault.definition);
    expect(aopDefinition.version).toBe(1);
    expect(aopDefinition.initialStep).toBe("iterate");
    expect(Object.keys(aopDefinition.steps).sort()).toEqual([
      "fix-issues",
      "full-review",
      "iterate",
      "quick-review",
    ]);
  });

  test("updates workflows on subsequent syncs", async () => {
    const workflows = await loadWorkflowsFromDirectory(workflowsDir);
    await syncWorkflows(repository, workflows);

    const initialSimple = await repository.findByName("simple");
    expect(initialSimple?.version).toBe(1);

    const secondResult = await syncWorkflows(repository, workflows);
    expect(secondResult.inserted).toBe(0);
    expect(secondResult.updated).toBe(6);

    const updatedSimple = await repository.findByName("simple");
    expect(updatedSimple?.version).toBe(2);
    expect(updatedSimple?.id).toBe(initialSimple?.id);
  });

  test("loads correct workflow definitions from YAML files", async () => {
    const workflows = await loadWorkflowsFromDirectory(workflowsDir);

    expect(workflows).toHaveLength(6);

    const simple = workflows.find((w) => w.name === "simple");
    expect(simple).toBeDefined();
    expect(simple?.terminalStates).toContain("__done__");
    expect(simple?.terminalStates).toContain("__blocked__");

    const aopDefault = workflows.find((w) => w.name === "aop-default");
    expect(aopDefault).toBeDefined();
    expect(aopDefault?.steps.iterate?.signals).toContainEqual(
      expect.objectContaining({ name: "CHUNK_DONE" }),
    );
    expect(aopDefault?.steps.iterate?.signals).toContainEqual(
      expect.objectContaining({ name: "ALL_TASKS_DONE" }),
    );
  });

  test("deactivates stale workflows on re-sync", async () => {
    await repository.create({
      id: "stale-id",
      name: "removed-workflow",
      definition: JSON.stringify({ version: 1, name: "removed-workflow", steps: {} }),
    });

    const workflows = await loadWorkflowsFromDirectory(workflowsDir);
    const result = await syncWorkflows(repository, workflows);

    expect(result.deactivated).toBe(1);

    const stale = await repository.findByName("removed-workflow");
    expect(stale).not.toBeNull();
    expect(stale?.active).toBe(false);

    const activeNames = await repository.listNames();
    expect(activeNames).not.toContain("removed-workflow");
  });
});
