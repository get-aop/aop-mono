import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cleanupTestDir, createTestDir } from "../test-helpers";
import type { Task } from "../types";
import {
  createTask,
  listTaskFolders,
  parseTask,
  updateTaskStatus,
  updateTaskTiming
} from "./task";

let TEST_DIR: string;
let DEVSFACTORY_DIR: string;

const sampleTaskMarkdown = `---
title: Add user authentication
status: PENDING
created: 2026-01-25T14:30:22Z
priority: high
tags:
  - auth
  - security
assignee: null
dependencies:
  - 20260124091500-setup-database
---

## Description
Users should be able to sign up and log in using email and password.

## Requirements
- Email must be unique and validated for format
- Passwords must be minimum 8 characters
- Use bcrypt for password hashing with cost factor 12

## Acceptance Criteria
- [ ] Users can register with email/password
- [x] Users can log in and receive a session
- [ ] Passwords are securely hashed

## Notes
Any additional context, links, or references...
`;

describe("parseTask", () => {
  beforeEach(async () => {
    TEST_DIR = await createTestDir("task-parse");
    DEVSFACTORY_DIR = `${TEST_DIR}/.devsfactory`;
    await Bun.$`mkdir -p ${DEVSFACTORY_DIR}/20260125143022-add-user-auth`;
    await Bun.write(
      `${DEVSFACTORY_DIR}/20260125143022-add-user-auth/task.md`,
      sampleTaskMarkdown
    );
  });

  afterEach(async () => {
    await cleanupTestDir(TEST_DIR);
  });

  test("parses task.md matching DESIGN.md format", async () => {
    const task = await parseTask(
      "20260125143022-add-user-auth",
      DEVSFACTORY_DIR
    );

    expect(task.folder).toBe("20260125143022-add-user-auth");
    expect(task.frontmatter.title).toBe("Add user authentication");
    expect(task.frontmatter.status).toBe("PENDING");
    expect(task.frontmatter.priority).toBe("high");
    expect(task.frontmatter.tags).toEqual(["auth", "security"]);
  });

  test("extracts all sections correctly", async () => {
    const task = await parseTask(
      "20260125143022-add-user-auth",
      DEVSFACTORY_DIR
    );

    expect(task.description).toContain(
      "Users should be able to sign up and log in"
    );
    expect(task.requirements).toContain("Email must be unique");
    expect(task.requirements).toContain(
      "Passwords must be minimum 8 characters"
    );
    expect(task.notes).toContain("Any additional context");
  });

  test("parses acceptance criteria checkboxes", async () => {
    const task = await parseTask(
      "20260125143022-add-user-auth",
      DEVSFACTORY_DIR
    );

    expect(task.acceptanceCriteria).toHaveLength(3);
    expect(task.acceptanceCriteria[0]).toEqual({
      text: "Users can register with email/password",
      checked: false
    });
    expect(task.acceptanceCriteria[1]).toEqual({
      text: "Users can log in and receive a session",
      checked: true
    });
    expect(task.acceptanceCriteria[2]).toEqual({
      text: "Passwords are securely hashed",
      checked: false
    });
  });

  test("handles missing optional notes section", async () => {
    const taskWithoutNotes = `---
title: Simple task
status: DRAFT
created: 2026-01-25T14:30:22Z
priority: low
tags: []
assignee: null
dependencies: []
---

## Description
A simple description.

## Requirements
- One requirement

## Acceptance Criteria
- [ ] One criterion
`;
    await Bun.write(
      `${DEVSFACTORY_DIR}/20260125143022-add-user-auth/task.md`,
      taskWithoutNotes
    );

    const task = await parseTask(
      "20260125143022-add-user-auth",
      DEVSFACTORY_DIR
    );

    expect(task.notes).toBeUndefined();
  });

  test("throws on non-existent task folder", async () => {
    await expect(
      parseTask("non-existent-folder", DEVSFACTORY_DIR)
    ).rejects.toThrow();
  });
});

describe("createTask", () => {
  beforeEach(async () => {
    TEST_DIR = await createTestDir("task-create");
    DEVSFACTORY_DIR = `${TEST_DIR}/.devsfactory`;
    await Bun.$`mkdir -p ${DEVSFACTORY_DIR}`;
  });

  afterEach(async () => {
    await cleanupTestDir(TEST_DIR);
  });

  test("creates valid file structure", async () => {
    const task: Omit<Task, "folder"> = {
      frontmatter: {
        title: "New feature",
        status: "DRAFT",
        created: new Date("2026-01-25T10:00:00Z"),
        priority: "medium",
        tags: ["feature"],
        assignee: null,
        dependencies: []
      },
      description: "Build a new feature",
      requirements: "- Must work",
      acceptanceCriteria: [{ text: "Feature works", checked: false }],
      notes: "Some notes"
    };

    await createTask("20260125100000-new-feature", task, DEVSFACTORY_DIR);

    const file = Bun.file(
      `${DEVSFACTORY_DIR}/20260125100000-new-feature/task.md`
    );
    expect(await file.exists()).toBe(true);
  });

  test("includes all sections", async () => {
    const task: Omit<Task, "folder"> = {
      frontmatter: {
        title: "Full task",
        status: "PENDING",
        created: new Date("2026-01-25T10:00:00Z"),
        priority: "high",
        tags: ["test", "example"],
        assignee: "agent-1",
        dependencies: ["dep-1"]
      },
      description: "This is the description.",
      requirements: "- Requirement 1\n- Requirement 2",
      acceptanceCriteria: [
        { text: "Criterion 1", checked: false },
        { text: "Criterion 2", checked: true }
      ],
      notes: "These are notes."
    };

    await createTask("20260125100000-full-task", task, DEVSFACTORY_DIR);

    const content = await Bun.file(
      `${DEVSFACTORY_DIR}/20260125100000-full-task/task.md`
    ).text();

    expect(content).toContain("## Description");
    expect(content).toContain("This is the description.");
    expect(content).toContain("## Requirements");
    expect(content).toContain("- Requirement 1");
    expect(content).toContain("## Acceptance Criteria");
    expect(content).toContain("- [ ] Criterion 1");
    expect(content).toContain("- [x] Criterion 2");
    expect(content).toContain("## Notes");
    expect(content).toContain("These are notes.");
  });

  test("roundtrip: create -> parse produces same data", async () => {
    const original: Omit<Task, "folder"> = {
      frontmatter: {
        title: "Roundtrip test",
        status: "BACKLOG",
        created: new Date("2026-01-25T12:00:00Z"),
        priority: "low",
        tags: ["a", "b"],
        assignee: null,
        dependencies: []
      },
      description: "Description text",
      requirements: "- Req 1",
      acceptanceCriteria: [{ text: "AC 1", checked: false }]
    };

    await createTask("20260125120000-roundtrip", original, DEVSFACTORY_DIR);
    const parsed = await parseTask("20260125120000-roundtrip", DEVSFACTORY_DIR);

    expect(parsed.frontmatter.title).toBe(original.frontmatter.title);
    expect(parsed.frontmatter.status).toBe(original.frontmatter.status);
    expect(parsed.frontmatter.priority).toBe(original.frontmatter.priority);
    expect(parsed.description).toContain("Description text");
    expect(parsed.acceptanceCriteria).toEqual(original.acceptanceCriteria);
  });
});

describe("updateTaskStatus", () => {
  beforeEach(async () => {
    TEST_DIR = await createTestDir("task-status");
    DEVSFACTORY_DIR = `${TEST_DIR}/.devsfactory`;
    await Bun.$`mkdir -p ${DEVSFACTORY_DIR}/20260125143022-status-test`;
    await Bun.write(
      `${DEVSFACTORY_DIR}/20260125143022-status-test/task.md`,
      sampleTaskMarkdown
    );
  });

  afterEach(async () => {
    await cleanupTestDir(TEST_DIR);
  });

  test("changes only status field", async () => {
    const originalTask = await parseTask(
      "20260125143022-status-test",
      DEVSFACTORY_DIR
    );
    expect(originalTask.frontmatter.status).toBe("PENDING");

    await updateTaskStatus(
      "20260125143022-status-test",
      "INPROGRESS",
      DEVSFACTORY_DIR
    );

    const updatedTask = await parseTask(
      "20260125143022-status-test",
      DEVSFACTORY_DIR
    );
    expect(updatedTask.frontmatter.status).toBe("INPROGRESS");
    expect(updatedTask.frontmatter.title).toBe(originalTask.frontmatter.title);
    expect(updatedTask.frontmatter.priority).toBe(
      originalTask.frontmatter.priority
    );
    expect(updatedTask.description).toBe(originalTask.description);
  });

  test("preserves all other content", async () => {
    await updateTaskStatus(
      "20260125143022-status-test",
      "DONE",
      DEVSFACTORY_DIR
    );

    const content = await Bun.file(
      `${DEVSFACTORY_DIR}/20260125143022-status-test/task.md`
    ).text();

    expect(content).toContain("## Description");
    expect(content).toContain("## Requirements");
    expect(content).toContain("## Acceptance Criteria");
    expect(content).toContain("## Notes");
  });

  test("throws on non-existent task", async () => {
    await expect(
      updateTaskStatus("non-existent", "DONE", DEVSFACTORY_DIR)
    ).rejects.toThrow();
  });
});

describe("listTaskFolders", () => {
  beforeEach(async () => {
    TEST_DIR = await createTestDir("task-list");
    DEVSFACTORY_DIR = `${TEST_DIR}/.devsfactory`;
    await Bun.$`mkdir -p ${DEVSFACTORY_DIR}`;
  });

  afterEach(async () => {
    await cleanupTestDir(TEST_DIR);
  });

  test("finds all task directories", async () => {
    await Bun.$`mkdir -p ${DEVSFACTORY_DIR}/20260125100000-task-a`;
    await Bun.$`mkdir -p ${DEVSFACTORY_DIR}/20260125110000-task-b`;
    await Bun.$`mkdir -p ${DEVSFACTORY_DIR}/20260125120000-task-c`;

    await Bun.write(
      `${DEVSFACTORY_DIR}/20260125100000-task-a/task.md`,
      sampleTaskMarkdown
    );
    await Bun.write(
      `${DEVSFACTORY_DIR}/20260125110000-task-b/task.md`,
      sampleTaskMarkdown
    );
    await Bun.write(
      `${DEVSFACTORY_DIR}/20260125120000-task-c/task.md`,
      sampleTaskMarkdown
    );

    const folders = await listTaskFolders(DEVSFACTORY_DIR);

    expect(folders).toHaveLength(3);
    expect(folders).toContain("20260125100000-task-a");
    expect(folders).toContain("20260125110000-task-b");
    expect(folders).toContain("20260125120000-task-c");
  });

  test("ignores directories without task.md", async () => {
    await Bun.$`mkdir -p ${DEVSFACTORY_DIR}/20260125100000-with-task`;
    await Bun.$`mkdir -p ${DEVSFACTORY_DIR}/20260125110000-no-task`;
    await Bun.$`mkdir -p ${DEVSFACTORY_DIR}/random-dir`;

    await Bun.write(
      `${DEVSFACTORY_DIR}/20260125100000-with-task/task.md`,
      sampleTaskMarkdown
    );
    await Bun.write(
      `${DEVSFACTORY_DIR}/20260125110000-no-task/other.md`,
      "not a task"
    );

    const folders = await listTaskFolders(DEVSFACTORY_DIR);

    expect(folders).toHaveLength(1);
    expect(folders).toContain("20260125100000-with-task");
    expect(folders).not.toContain("20260125110000-no-task");
    expect(folders).not.toContain("random-dir");
  });

  test("returns sorted list", async () => {
    await Bun.$`mkdir -p ${DEVSFACTORY_DIR}/20260125120000-task-c`;
    await Bun.$`mkdir -p ${DEVSFACTORY_DIR}/20260125100000-task-a`;
    await Bun.$`mkdir -p ${DEVSFACTORY_DIR}/20260125110000-task-b`;

    await Bun.write(
      `${DEVSFACTORY_DIR}/20260125120000-task-c/task.md`,
      sampleTaskMarkdown
    );
    await Bun.write(
      `${DEVSFACTORY_DIR}/20260125100000-task-a/task.md`,
      sampleTaskMarkdown
    );
    await Bun.write(
      `${DEVSFACTORY_DIR}/20260125110000-task-b/task.md`,
      sampleTaskMarkdown
    );

    const folders = await listTaskFolders(DEVSFACTORY_DIR);

    expect(folders).toEqual([
      "20260125100000-task-a",
      "20260125110000-task-b",
      "20260125120000-task-c"
    ]);
  });

  test("returns empty array for empty directory", async () => {
    const folders = await listTaskFolders(DEVSFACTORY_DIR);

    expect(folders).toEqual([]);
  });

  test("returns empty array for non-existent directory", async () => {
    const folders = await listTaskFolders(`${TEST_DIR}/non-existent-dir`);

    expect(folders).toEqual([]);
  });
});

describe("updateTaskTiming", () => {
  beforeEach(async () => {
    TEST_DIR = await createTestDir("task-timing");
    DEVSFACTORY_DIR = `${TEST_DIR}/.devsfactory`;
    await Bun.$`mkdir -p ${DEVSFACTORY_DIR}/20260125143022-timing-test`;
    await Bun.write(
      `${DEVSFACTORY_DIR}/20260125143022-timing-test/task.md`,
      sampleTaskMarkdown
    );
  });

  afterEach(async () => {
    await cleanupTestDir(TEST_DIR);
  });

  test("sets startedAt timestamp", async () => {
    const startedAt = new Date("2026-01-27T10:00:00Z");

    await updateTaskTiming(
      "20260125143022-timing-test",
      { startedAt },
      DEVSFACTORY_DIR
    );

    const updated = await parseTask(
      "20260125143022-timing-test",
      DEVSFACTORY_DIR
    );

    expect(updated.frontmatter.startedAt).toEqual(startedAt);
  });

  test("sets completedAt timestamp", async () => {
    const completedAt = new Date("2026-01-27T11:00:00Z");

    await updateTaskTiming(
      "20260125143022-timing-test",
      { completedAt },
      DEVSFACTORY_DIR
    );

    const updated = await parseTask(
      "20260125143022-timing-test",
      DEVSFACTORY_DIR
    );

    expect(updated.frontmatter.completedAt).toEqual(completedAt);
  });

  test("sets durationMs", async () => {
    const durationMs = 3600000;

    await updateTaskTiming(
      "20260125143022-timing-test",
      { durationMs },
      DEVSFACTORY_DIR
    );

    const updated = await parseTask(
      "20260125143022-timing-test",
      DEVSFACTORY_DIR
    );

    expect(updated.frontmatter.durationMs).toBe(durationMs);
  });

  test("sets all timing fields at once", async () => {
    const startedAt = new Date("2026-01-27T10:00:00Z");
    const completedAt = new Date("2026-01-27T11:00:00Z");
    const durationMs = 3600000;

    await updateTaskTiming(
      "20260125143022-timing-test",
      { startedAt, completedAt, durationMs },
      DEVSFACTORY_DIR
    );

    const updated = await parseTask(
      "20260125143022-timing-test",
      DEVSFACTORY_DIR
    );

    expect(updated.frontmatter.startedAt).toEqual(startedAt);
    expect(updated.frontmatter.completedAt).toEqual(completedAt);
    expect(updated.frontmatter.durationMs).toBe(durationMs);
  });

  test("merges with existing timing data", async () => {
    await updateTaskTiming(
      "20260125143022-timing-test",
      { startedAt: new Date("2026-01-27T10:00:00Z") },
      DEVSFACTORY_DIR
    );

    await updateTaskTiming(
      "20260125143022-timing-test",
      { completedAt: new Date("2026-01-27T11:00:00Z") },
      DEVSFACTORY_DIR
    );

    const updated = await parseTask(
      "20260125143022-timing-test",
      DEVSFACTORY_DIR
    );

    expect(updated.frontmatter.startedAt).toEqual(
      new Date("2026-01-27T10:00:00Z")
    );
    expect(updated.frontmatter.completedAt).toEqual(
      new Date("2026-01-27T11:00:00Z")
    );
  });

  test("preserves other frontmatter fields", async () => {
    const original = await parseTask(
      "20260125143022-timing-test",
      DEVSFACTORY_DIR
    );

    await updateTaskTiming(
      "20260125143022-timing-test",
      { startedAt: new Date() },
      DEVSFACTORY_DIR
    );

    const updated = await parseTask(
      "20260125143022-timing-test",
      DEVSFACTORY_DIR
    );

    expect(updated.frontmatter.title).toBe(original.frontmatter.title);
    expect(updated.frontmatter.status).toBe(original.frontmatter.status);
    expect(updated.frontmatter.priority).toBe(original.frontmatter.priority);
    expect(updated.frontmatter.tags).toEqual(original.frontmatter.tags);
    expect(updated.description).toBe(original.description);
  });

  test("throws on non-existent task", async () => {
    await expect(
      updateTaskTiming(
        "non-existent-task",
        { startedAt: new Date() },
        DEVSFACTORY_DIR
      )
    ).rejects.toThrow();
  });

  test("timing roundtrip: write -> read preserves all values", async () => {
    const startedAt = new Date("2026-01-27T10:00:00Z");
    const completedAt = new Date("2026-01-27T11:30:00Z");
    const durationMs = 5400000;

    await updateTaskTiming(
      "20260125143022-timing-test",
      { startedAt, completedAt, durationMs },
      DEVSFACTORY_DIR
    );

    const parsed = await parseTask(
      "20260125143022-timing-test",
      DEVSFACTORY_DIR
    );

    expect(parsed.frontmatter.startedAt).toEqual(startedAt);
    expect(parsed.frontmatter.completedAt).toEqual(completedAt);
    expect(parsed.frontmatter.durationMs).toBe(durationMs);
  });
});
