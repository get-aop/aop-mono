import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { ParseError } from "../errors";
import { cleanupTestDir, createTestDir } from "../test-helpers";
import { parsePlan } from "./plan";

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

  test("throws ParseError with file path for invalid status", async () => {
    const invalidPlan = `---
status: DONE
task: 20260125143022-invalid
created: 2026-01-25T15:00:00Z
---

## Subtasks
`;
    await Bun.write(
      `${DEVSFACTORY_DIR}/20260125143022-add-user-auth/plan.md`,
      invalidPlan
    );

    try {
      await parsePlan("20260125143022-add-user-auth", DEVSFACTORY_DIR);
      expect.unreachable("Should have thrown ParseError");
    } catch (error) {
      expect(error).toBeInstanceOf(ParseError);
      const parseError = error as ParseError;
      expect(parseError.filePath).toContain("plan.md");
      expect(parseError.message).toContain("plan.md");
      expect(parseError.message).toContain("status");
    }
  });
});
