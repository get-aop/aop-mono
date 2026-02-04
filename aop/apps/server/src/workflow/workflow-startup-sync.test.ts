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

    expect(result.inserted).toBe(2);
    expect(result.updated).toBe(0);

    const simple = await repository.findByName("simple");
    expect(simple).not.toBeNull();
    expect(simple?.name).toBe("simple");

    if (!simple) throw new Error("Expected simple workflow to exist");
    const simpleDefinition = JSON.parse(simple.definition);
    expect(simpleDefinition.version).toBe(1);
    expect(simpleDefinition.initialStep).toBe("implement");
    expect(simpleDefinition.steps.implement.type).toBe("implement");

    const ralphLoop = await repository.findByName("ralph-loop");
    expect(ralphLoop).not.toBeNull();
    expect(ralphLoop?.name).toBe("ralph-loop");

    if (!ralphLoop) throw new Error("Expected ralph-loop workflow to exist");
    const ralphDefinition = JSON.parse(ralphLoop.definition);
    expect(ralphDefinition.version).toBe(1);
    expect(ralphDefinition.initialStep).toBe("iterate");
    expect(ralphDefinition.steps.iterate.type).toBe("iterate");
    expect(ralphDefinition.steps.review.type).toBe("review");
  });

  test("updates workflows on subsequent syncs", async () => {
    const workflows = await loadWorkflowsFromDirectory(workflowsDir);
    await syncWorkflows(repository, workflows);

    const initialSimple = await repository.findByName("simple");
    expect(initialSimple?.version).toBe(1);

    const secondResult = await syncWorkflows(repository, workflows);
    expect(secondResult.inserted).toBe(0);
    expect(secondResult.updated).toBe(2);

    const updatedSimple = await repository.findByName("simple");
    expect(updatedSimple?.version).toBe(2);
    expect(updatedSimple?.id).toBe(initialSimple?.id);
  });

  test("loads correct workflow definitions from YAML files", async () => {
    const workflows = await loadWorkflowsFromDirectory(workflowsDir);

    expect(workflows).toHaveLength(2);

    const simple = workflows.find((w) => w.name === "simple");
    expect(simple).toBeDefined();
    expect(simple?.terminalStates).toContain("__done__");
    expect(simple?.terminalStates).toContain("__blocked__");

    const ralphLoop = workflows.find((w) => w.name === "ralph-loop");
    expect(ralphLoop).toBeDefined();
    const iterateStep = ralphLoop?.steps.iterate;
    expect(iterateStep?.signals).toContain("TASK_COMPLETE");
    expect(iterateStep?.signals).toContain("NEEDS_REVIEW");
  });
});
