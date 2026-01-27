import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cleanupTestDir, createTestDir } from "../test-helpers";
import type { Plan, SubtaskReference } from "../types";
import {
  addSubtaskToPlan,
  appendPlanBlockers,
  createPlan,
  parsePlan,
  updatePlanStatus
} from "./plan";

let TEST_DIR: string;
let DEVSFACTORY_DIR: string;

const samplePlanMarkdown = `---
status: INPROGRESS
task: 20260125143022-add-user-auth
created: 2026-01-25T15:00:00Z
---

## Subtasks
1. 001-create-user-model (Create user model)
2. 002-add-password-hashing (Add password hashing) → depends on: 001
3. 003-setup-auth-routes (Setup auth routes) → depends on: 001, 002

## Result

(filled after all subtasks complete)

## Review Attempts

### Review Attempt 1

(to be filled by the Reviewer Agent)
`;

describe("parsePlan", () => {
  beforeEach(async () => {
    TEST_DIR = await createTestDir("plan");
    DEVSFACTORY_DIR = `${TEST_DIR}/.devsfactory`;
    await Bun.$`mkdir -p ${DEVSFACTORY_DIR}/20260125143022-add-user-auth`;
    await Bun.write(
      `${DEVSFACTORY_DIR}/20260125143022-add-user-auth/plan.md`,
      samplePlanMarkdown
    );
  });

  afterEach(async () => {
    await cleanupTestDir(TEST_DIR);
  });

  test("parses plan.md matching DESIGN.md format", async () => {
    const plan = await parsePlan(
      "20260125143022-add-user-auth",
      DEVSFACTORY_DIR
    );

    expect(plan).not.toBeNull();
    expect(plan!.folder).toBe("20260125143022-add-user-auth");
    expect(plan!.frontmatter.status).toBe("INPROGRESS");
    expect(plan!.frontmatter.task).toBe("20260125143022-add-user-auth");
    expect(plan!.frontmatter.created).toEqual(new Date("2026-01-25T15:00:00Z"));
  });

  test("returns null for missing file", async () => {
    const plan = await parsePlan("non-existent-folder", DEVSFACTORY_DIR);

    expect(plan).toBeNull();
  });

  test("parses subtask references with dependencies", async () => {
    const plan = await parsePlan(
      "20260125143022-add-user-auth",
      DEVSFACTORY_DIR
    );

    expect(plan).not.toBeNull();
    expect(plan!.subtasks).toHaveLength(3);

    expect(plan!.subtasks[0]).toEqual({
      number: 1,
      slug: "create-user-model",
      title: "Create user model",
      dependencies: []
    });

    expect(plan!.subtasks[1]).toEqual({
      number: 2,
      slug: "add-password-hashing",
      title: "Add password hashing",
      dependencies: [1]
    });

    expect(plan!.subtasks[2]).toEqual({
      number: 3,
      slug: "setup-auth-routes",
      title: "Setup auth routes",
      dependencies: [1, 2]
    });
  });

  test("handles subtasks without dependencies", async () => {
    const planWithNoDeps = `---
status: INPROGRESS
task: 20260125143022-simple-task
created: 2026-01-25T15:00:00Z
---

## Subtasks
1. 001-first-subtask (First subtask)
2. 002-second-subtask (Second subtask)
`;
    await Bun.write(
      `${DEVSFACTORY_DIR}/20260125143022-add-user-auth/plan.md`,
      planWithNoDeps
    );

    const plan = await parsePlan(
      "20260125143022-add-user-auth",
      DEVSFACTORY_DIR
    );

    expect(plan).not.toBeNull();
    expect(plan!.subtasks).toHaveLength(2);
    expect(plan!.subtasks[0]!.dependencies).toEqual([]);
    expect(plan!.subtasks[1]!.dependencies).toEqual([]);
  });

  test("handles empty subtasks section", async () => {
    const planNoSubtasks = `---
status: INPROGRESS
task: 20260125143022-empty-plan
created: 2026-01-25T15:00:00Z
---

## Subtasks

## Result

(nothing yet)
`;
    await Bun.write(
      `${DEVSFACTORY_DIR}/20260125143022-add-user-auth/plan.md`,
      planNoSubtasks
    );

    const plan = await parsePlan(
      "20260125143022-add-user-auth",
      DEVSFACTORY_DIR
    );

    expect(plan).not.toBeNull();
    expect(plan!.subtasks).toEqual([]);
  });

  test("extracts subtask number from filename, not list ordinal", async () => {
    const planWithGaps = `---
status: INPROGRESS
task: 20260125143022-gaps
created: 2026-01-25T15:00:00Z
---

## Subtasks
1. 005-hotfix (Hotfix for issue)
2. 010-feature (New feature) → depends on: 005
`;
    await Bun.write(
      `${DEVSFACTORY_DIR}/20260125143022-add-user-auth/plan.md`,
      planWithGaps
    );

    const plan = await parsePlan(
      "20260125143022-add-user-auth",
      DEVSFACTORY_DIR
    );

    expect(plan).not.toBeNull();
    expect(plan!.subtasks).toHaveLength(2);
    expect(plan!.subtasks[0]!.number).toBe(5);
    expect(plan!.subtasks[1]!.number).toBe(10);
    expect(plan!.subtasks[1]!.dependencies).toEqual([5]);
  });
});

describe("createPlan", () => {
  beforeEach(async () => {
    TEST_DIR = await createTestDir("plan-create");
    DEVSFACTORY_DIR = `${TEST_DIR}/.devsfactory`;
    await Bun.$`mkdir -p ${DEVSFACTORY_DIR}/20260125143022-new-task`;
  });

  afterEach(async () => {
    await cleanupTestDir(TEST_DIR);
  });

  test("creates valid file with correct format", async () => {
    const plan: Omit<Plan, "folder"> = {
      frontmatter: {
        status: "INPROGRESS",
        task: "20260125143022-new-task",
        created: new Date("2026-01-25T16:00:00Z")
      },
      subtasks: [
        {
          number: 1,
          slug: "setup-db",
          title: "Setup database",
          dependencies: []
        }
      ]
    };

    await createPlan("20260125143022-new-task", plan, DEVSFACTORY_DIR);

    const file = Bun.file(`${DEVSFACTORY_DIR}/20260125143022-new-task/plan.md`);
    expect(await file.exists()).toBe(true);

    const content = await file.text();
    expect(content).toContain("status: INPROGRESS");
    expect(content).toContain("task: 20260125143022-new-task");
  });

  test("serializes subtask list correctly", async () => {
    const plan: Omit<Plan, "folder"> = {
      frontmatter: {
        status: "INPROGRESS",
        task: "20260125143022-new-task",
        created: new Date("2026-01-25T16:00:00Z")
      },
      subtasks: [
        {
          number: 1,
          slug: "first-task",
          title: "First task",
          dependencies: []
        },
        {
          number: 2,
          slug: "second-task",
          title: "Second task",
          dependencies: [1]
        },
        {
          number: 3,
          slug: "third-task",
          title: "Third task",
          dependencies: [1, 2]
        }
      ]
    };

    await createPlan("20260125143022-new-task", plan, DEVSFACTORY_DIR);

    const content = await Bun.file(
      `${DEVSFACTORY_DIR}/20260125143022-new-task/plan.md`
    ).text();

    expect(content).toContain("## Subtasks");
    expect(content).toContain("1. 001-first-task (First task)");
    expect(content).toContain(
      "2. 002-second-task (Second task) → depends on: 001"
    );
    expect(content).toContain(
      "3. 003-third-task (Third task) → depends on: 001, 002"
    );
  });

  test("roundtrip: create -> parse produces same data", async () => {
    const original: Omit<Plan, "folder"> = {
      frontmatter: {
        status: "INPROGRESS",
        task: "20260125143022-new-task",
        created: new Date("2026-01-25T16:00:00Z")
      },
      subtasks: [
        { number: 1, slug: "subtask-a", title: "Subtask A", dependencies: [] },
        { number: 2, slug: "subtask-b", title: "Subtask B", dependencies: [1] }
      ]
    };

    await createPlan("20260125143022-new-task", original, DEVSFACTORY_DIR);
    const parsed = await parsePlan("20260125143022-new-task", DEVSFACTORY_DIR);

    expect(parsed).not.toBeNull();
    expect(parsed!.frontmatter.status).toBe(original.frontmatter.status);
    expect(parsed!.frontmatter.task).toBe(original.frontmatter.task);
    expect(parsed!.subtasks).toEqual(original.subtasks);
  });
});

describe("updatePlanStatus", () => {
  beforeEach(async () => {
    TEST_DIR = await createTestDir("plan-status");
    DEVSFACTORY_DIR = `${TEST_DIR}/.devsfactory`;
    await Bun.$`mkdir -p ${DEVSFACTORY_DIR}/20260125143022-status-test`;
    await Bun.write(
      `${DEVSFACTORY_DIR}/20260125143022-status-test/plan.md`,
      samplePlanMarkdown
    );
  });

  afterEach(async () => {
    await cleanupTestDir(TEST_DIR);
  });

  test("changes only status field", async () => {
    const originalPlan = await parsePlan(
      "20260125143022-status-test",
      DEVSFACTORY_DIR
    );
    expect(originalPlan!.frontmatter.status).toBe("INPROGRESS");

    await updatePlanStatus(
      "20260125143022-status-test",
      "REVIEW",
      DEVSFACTORY_DIR
    );

    const updatedPlan = await parsePlan(
      "20260125143022-status-test",
      DEVSFACTORY_DIR
    );
    expect(updatedPlan!.frontmatter.status).toBe("REVIEW");
    expect(updatedPlan!.frontmatter.task).toBe(originalPlan!.frontmatter.task);
    expect(updatedPlan!.subtasks).toEqual(originalPlan!.subtasks);
  });

  test("throws on non-existent plan", async () => {
    await expect(
      updatePlanStatus("non-existent", "BLOCKED", DEVSFACTORY_DIR)
    ).rejects.toThrow();
  });
});

describe("addSubtaskToPlan", () => {
  beforeEach(async () => {
    TEST_DIR = await createTestDir("plan-add-subtask");
    DEVSFACTORY_DIR = `${TEST_DIR}/.devsfactory`;
    await Bun.$`mkdir -p ${DEVSFACTORY_DIR}/20260125143022-add-subtask`;
    await Bun.write(
      `${DEVSFACTORY_DIR}/20260125143022-add-subtask/plan.md`,
      samplePlanMarkdown
    );
  });

  afterEach(async () => {
    await cleanupTestDir(TEST_DIR);
  });

  test("appends to existing list", async () => {
    const originalPlan = await parsePlan(
      "20260125143022-add-subtask",
      DEVSFACTORY_DIR
    );
    expect(originalPlan!.subtasks).toHaveLength(3);

    const newSubtask: SubtaskReference = {
      number: 4,
      slug: "new-subtask",
      title: "New subtask",
      dependencies: [3]
    };

    await addSubtaskToPlan(
      "20260125143022-add-subtask",
      newSubtask,
      DEVSFACTORY_DIR
    );

    const updatedPlan = await parsePlan(
      "20260125143022-add-subtask",
      DEVSFACTORY_DIR
    );
    expect(updatedPlan!.subtasks).toHaveLength(4);
    expect(updatedPlan!.subtasks[3]).toEqual(newSubtask);
  });

  test("throws if plan doesn't exist", async () => {
    const newSubtask: SubtaskReference = {
      number: 1,
      slug: "first",
      title: "First",
      dependencies: []
    };

    await expect(
      addSubtaskToPlan("non-existent-plan", newSubtask, DEVSFACTORY_DIR)
    ).rejects.toThrow();
  });

  test("preserves existing subtasks and other content", async () => {
    const newSubtask: SubtaskReference = {
      number: 4,
      slug: "added-subtask",
      title: "Added subtask",
      dependencies: [2]
    };

    await addSubtaskToPlan(
      "20260125143022-add-subtask",
      newSubtask,
      DEVSFACTORY_DIR
    );

    const content = await Bun.file(
      `${DEVSFACTORY_DIR}/20260125143022-add-subtask/plan.md`
    ).text();

    expect(content).toContain("1. 001-create-user-model (Create user model)");
    expect(content).toContain(
      "2. 002-add-password-hashing (Add password hashing) → depends on: 001"
    );
    expect(content).toContain(
      "3. 003-setup-auth-routes (Setup auth routes) → depends on: 001, 002"
    );
    expect(content).toContain(
      "4. 004-added-subtask (Added subtask) → depends on: 002"
    );
    expect(content).toContain("## Result");
  });
});

describe("appendPlanBlockers", () => {
  beforeEach(async () => {
    TEST_DIR = await createTestDir("plan-blockers");
    DEVSFACTORY_DIR = `${TEST_DIR}/.devsfactory`;
    await Bun.$`mkdir -p ${DEVSFACTORY_DIR}/20260125143022-blockers-test`;
  });

  afterEach(async () => {
    await cleanupTestDir(TEST_DIR);
  });

  test("appends blocker message to existing Blockers section", async () => {
    const planWithBlockers = `---
status: INPROGRESS
task: 20260125143022-blockers-test
created: 2026-01-25T15:00:00Z
---

## Subtasks

1. 001-first-task (First task)

### Blockers

(filled when agent gets stuck or needs user input)
`;
    await Bun.write(
      `${DEVSFACTORY_DIR}/20260125143022-blockers-test/plan.md`,
      planWithBlockers
    );

    await appendPlanBlockers(
      "20260125143022-blockers-test",
      "Merge conflict in 001-first-task.md could not be resolved",
      DEVSFACTORY_DIR
    );

    const content = await Bun.file(
      `${DEVSFACTORY_DIR}/20260125143022-blockers-test/plan.md`
    ).text();

    expect(content).toContain("### Blockers");
    expect(content).toContain(
      "Merge conflict in 001-first-task.md could not be resolved"
    );
    expect(content).not.toContain(
      "(filled when agent gets stuck or needs user input)"
    );
  });

  test("adds timestamp to blocker entry", async () => {
    const planWithBlockers = `---
status: INPROGRESS
task: 20260125143022-blockers-test
created: 2026-01-25T15:00:00Z
---

## Subtasks

1. 001-first-task (First task)

### Blockers

(filled when agent gets stuck or needs user input)
`;
    await Bun.write(
      `${DEVSFACTORY_DIR}/20260125143022-blockers-test/plan.md`,
      planWithBlockers
    );

    await appendPlanBlockers(
      "20260125143022-blockers-test",
      "Test blocker message",
      DEVSFACTORY_DIR
    );

    const content = await Bun.file(
      `${DEVSFACTORY_DIR}/20260125143022-blockers-test/plan.md`
    ).text();

    expect(content).toMatch(/- \[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  test("throws when plan does not exist", async () => {
    await expect(
      appendPlanBlockers("non-existent-plan", "Some blocker", DEVSFACTORY_DIR)
    ).rejects.toThrow("Plan not found");
  });

  test("creates Blockers section if it does not exist", async () => {
    const planWithoutBlockers = `---
status: INPROGRESS
task: 20260125143022-blockers-test
created: 2026-01-25T15:00:00Z
---

## Subtasks

1. 001-first-task (First task)

## Result

(filled after all subtasks complete)
`;
    await Bun.write(
      `${DEVSFACTORY_DIR}/20260125143022-blockers-test/plan.md`,
      planWithoutBlockers
    );

    await appendPlanBlockers(
      "20260125143022-blockers-test",
      "New blocker added",
      DEVSFACTORY_DIR
    );

    const content = await Bun.file(
      `${DEVSFACTORY_DIR}/20260125143022-blockers-test/plan.md`
    ).text();

    expect(content).toContain("### Blockers");
    expect(content).toContain("New blocker added");
  });

  test("appends multiple blockers", async () => {
    const planWithBlockers = `---
status: INPROGRESS
task: 20260125143022-blockers-test
created: 2026-01-25T15:00:00Z
---

## Subtasks

1. 001-first-task (First task)

### Blockers

(filled when agent gets stuck or needs user input)
`;
    await Bun.write(
      `${DEVSFACTORY_DIR}/20260125143022-blockers-test/plan.md`,
      planWithBlockers
    );

    await appendPlanBlockers(
      "20260125143022-blockers-test",
      "First blocker",
      DEVSFACTORY_DIR
    );

    await appendPlanBlockers(
      "20260125143022-blockers-test",
      "Second blocker",
      DEVSFACTORY_DIR
    );

    const content = await Bun.file(
      `${DEVSFACTORY_DIR}/20260125143022-blockers-test/plan.md`
    ).text();

    expect(content).toContain("First blocker");
    expect(content).toContain("Second blocker");
  });
});
