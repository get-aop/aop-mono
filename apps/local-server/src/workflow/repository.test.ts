import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Kysely } from "kysely";
import type { Database } from "../db/schema.ts";
import { createTestDb } from "../db/test-utils.ts";
import { createWorkflowRepository, type WorkflowRepository } from "./repository.ts";

describe("WorkflowRepository", () => {
  let db: Kysely<Database>;
  let repository: WorkflowRepository;

  beforeEach(async () => {
    db = await createTestDb();
    repository = createWorkflowRepository(db);
  });

  afterEach(async () => {
    await db.destroy();
  });

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
    expect(workflow.active).toBe(true);
    expect(workflow.created_at).toBeDefined();
  });

  test("finds a workflow by ID", async () => {
    await repository.create({
      id: "workflow-1",
      name: "simple",
      definition: "{}",
    });

    const workflow = await repository.findById("workflow-1");

    expect(workflow?.name).toBe("simple");
  });

  test("finds a workflow by name", async () => {
    await repository.create({
      id: "workflow-1",
      name: "tdd-workflow",
      definition: "{}",
    });

    const workflow = await repository.findByName("tdd-workflow");

    expect(workflow?.id).toBe("workflow-1");
  });

  test("lists active workflow names in alphabetical order", async () => {
    await repository.create({ id: "w-1", name: "zeta-workflow", definition: "{}" });
    await repository.create({ id: "w-2", name: "alpha-workflow", definition: "{}" });
    await repository.create({ id: "w-3", name: "mid-workflow", definition: "{}" });

    const names = await repository.listNames();

    expect(names).toEqual(["alpha-workflow", "mid-workflow", "zeta-workflow"]);
  });

  test("excludes inactive workflows from active names but keeps them in all names", async () => {
    await repository.create({ id: "w-1", name: "active-wf", definition: "{}" });
    await repository.create({ id: "w-2", name: "inactive-wf", definition: "{}" });
    await repository.deactivateByName("inactive-wf");

    expect(await repository.listNames()).toEqual(["active-wf"]);
    expect(await repository.listAllNames()).toEqual(["active-wf", "inactive-wf"]);
  });

  test("upsert inserts new workflows and updates existing ones", async () => {
    const inserted = await repository.upsert({
      id: "workflow-1",
      name: "versioned-workflow",
      definition: JSON.stringify({ v: 1 }),
    });

    const updated = await repository.upsert({
      id: "workflow-2",
      name: "versioned-workflow",
      definition: JSON.stringify({ v: 2 }),
    });

    expect(inserted.version).toBe(1);
    expect(updated.id).toBe("workflow-1");
    expect(updated.version).toBe(2);
    expect(updated.definition).toBe(JSON.stringify({ v: 2 }));
    expect(updated.active).toBe(true);
  });

  test("reactivates a workflow on upsert", async () => {
    await repository.create({
      id: "workflow-1",
      name: "reactivate-me",
      definition: JSON.stringify({ v: 1 }),
    });
    await repository.deactivateByName("reactivate-me");

    const updated = await repository.upsert({
      id: "workflow-2",
      name: "reactivate-me",
      definition: JSON.stringify({ v: 2 }),
    });

    expect(updated.active).toBe(true);
    expect(updated.version).toBe(2);
  });
});
