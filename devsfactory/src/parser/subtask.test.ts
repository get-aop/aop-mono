import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cleanupTestDir, createTestDir } from "../test-helpers";
import type { Subtask } from "../types";
import {
  appendReviewHistory,
  createSubtask,
  getReadySubtasks,
  listSubtasks,
  parseSubtask,
  recordPhaseDuration,
  updateSubtaskStatus,
  updateSubtaskTiming
} from "./subtask";

let TEST_DIR: string;
let DEVSFACTORY_DIR: string;
const TASK_FOLDER = "20260125143022-add-user-auth";

const sampleSubtaskMarkdown = `---
title: Create user model with email/password fields
status: PENDING
dependencies:
  - 1
---

### Description
Create a User model with email and hashed password fields using bun:sqlite.

### Context
- Reference: \`src/db/schema.ts\` for existing model patterns
- Reference: \`src/utils/hash.ts\` for password hashing
- See: https://bun.sh/docs/api/sqlite

### Result
(filled by agent after completion)

### Review
(filled by review agent)

### Blockers
(filled when agent gets stuck or needs user input)
`;

describe("parseSubtask", () => {
  beforeEach(async () => {
    TEST_DIR = await createTestDir("subtask-parse");
    DEVSFACTORY_DIR = `${TEST_DIR}/.devsfactory`;
    await Bun.$`mkdir -p ${DEVSFACTORY_DIR}/${TASK_FOLDER}`;
    await Bun.write(
      `${DEVSFACTORY_DIR}/${TASK_FOLDER}/002-create-user-model.md`,
      sampleSubtaskMarkdown
    );
  });

  afterEach(async () => {
    await cleanupTestDir(TEST_DIR);
  });

  test("extracts number and slug from filename", async () => {
    const subtask = await parseSubtask(
      TASK_FOLDER,
      "002-create-user-model.md",
      DEVSFACTORY_DIR
    );

    expect(subtask.number).toBe(2);
    expect(subtask.slug).toBe("create-user-model");
    expect(subtask.filename).toBe("002-create-user-model.md");
  });

  test("extracts all markdown sections", async () => {
    const subtask = await parseSubtask(
      TASK_FOLDER,
      "002-create-user-model.md",
      DEVSFACTORY_DIR
    );

    expect(subtask.description).toContain("Create a User model");
    expect(subtask.context).toContain("src/db/schema.ts");
    expect(subtask.result).toContain("filled by agent");
    expect(subtask.review).toContain("filled by review agent");
    expect(subtask.blockers).toContain("filled when agent gets stuck");
  });

  test("handles missing optional sections", async () => {
    const minimalSubtask = `---
title: Minimal subtask
status: PENDING
dependencies: []
---

### Description
Just a description.
`;
    await Bun.write(
      `${DEVSFACTORY_DIR}/${TASK_FOLDER}/001-minimal.md`,
      minimalSubtask
    );

    const subtask = await parseSubtask(
      TASK_FOLDER,
      "001-minimal.md",
      DEVSFACTORY_DIR
    );

    expect(subtask.description).toContain("Just a description");
    expect(subtask.context).toBeUndefined();
    expect(subtask.result).toBeUndefined();
    expect(subtask.review).toBeUndefined();
    expect(subtask.blockers).toBeUndefined();
  });

  test("parses dependencies from frontmatter", async () => {
    const subtask = await parseSubtask(
      TASK_FOLDER,
      "002-create-user-model.md",
      DEVSFACTORY_DIR
    );

    expect(subtask.frontmatter.dependencies).toEqual([1]);
  });

  test("throws on non-existent file", async () => {
    await expect(
      parseSubtask(TASK_FOLDER, "999-nonexistent.md", DEVSFACTORY_DIR)
    ).rejects.toThrow();
  });
});

describe("createSubtask", () => {
  beforeEach(async () => {
    TEST_DIR = await createTestDir("subtask-create");
    DEVSFACTORY_DIR = `${TEST_DIR}/.devsfactory`;
    await Bun.$`mkdir -p ${DEVSFACTORY_DIR}/${TASK_FOLDER}`;
  });

  afterEach(async () => {
    await cleanupTestDir(TEST_DIR);
  });

  test("generates correct numbering (first subtask = 001)", async () => {
    const subtask: Omit<Subtask, "filename" | "number" | "slug"> = {
      frontmatter: {
        title: "First subtask",
        status: "PENDING",
        dependencies: []
      },
      description: "Description of first subtask"
    };

    const filename = await createSubtask(TASK_FOLDER, subtask, DEVSFACTORY_DIR);

    expect(filename).toBe("001-first-subtask.md");
    const file = Bun.file(`${DEVSFACTORY_DIR}/${TASK_FOLDER}/${filename}`);
    expect(await file.exists()).toBe(true);
  });

  test("auto-increments from existing subtasks", async () => {
    await Bun.write(
      `${DEVSFACTORY_DIR}/${TASK_FOLDER}/001-existing.md`,
      sampleSubtaskMarkdown
    );
    await Bun.write(
      `${DEVSFACTORY_DIR}/${TASK_FOLDER}/002-another.md`,
      sampleSubtaskMarkdown
    );

    const subtask: Omit<Subtask, "filename" | "number" | "slug"> = {
      frontmatter: {
        title: "Third subtask",
        status: "PENDING",
        dependencies: [1, 2]
      },
      description: "Description of third subtask"
    };

    const filename = await createSubtask(TASK_FOLDER, subtask, DEVSFACTORY_DIR);

    expect(filename).toBe("003-third-subtask.md");
  });

  test("slugifies title correctly", async () => {
    const subtask: Omit<Subtask, "filename" | "number" | "slug"> = {
      frontmatter: {
        title: "Add User Authentication!!! With OAUTH2",
        status: "PENDING",
        dependencies: []
      },
      description: "OAuth implementation"
    };

    const filename = await createSubtask(TASK_FOLDER, subtask, DEVSFACTORY_DIR);

    expect(filename).toBe("001-add-user-authentication-with-oauth2.md");
  });

  test("includes all sections in created file", async () => {
    const subtask: Omit<Subtask, "filename" | "number" | "slug"> = {
      frontmatter: {
        title: "Full subtask",
        status: "PENDING",
        dependencies: [1]
      },
      description: "Description content",
      context: "Context content",
      result: "Result content",
      review: "Review content",
      blockers: "Blockers content"
    };

    const filename = await createSubtask(TASK_FOLDER, subtask, DEVSFACTORY_DIR);

    const content = await Bun.file(
      `${DEVSFACTORY_DIR}/${TASK_FOLDER}/${filename}`
    ).text();

    expect(content).toContain("### Description");
    expect(content).toContain("Description content");
    expect(content).toContain("### Context");
    expect(content).toContain("Context content");
    expect(content).toContain("### Result");
    expect(content).toContain("Result content");
    expect(content).toContain("### Review");
    expect(content).toContain("Review content");
    expect(content).toContain("### Blockers");
    expect(content).toContain("Blockers content");
  });

  test("roundtrip: create -> parse produces same data", async () => {
    const original: Omit<Subtask, "filename" | "number" | "slug"> = {
      frontmatter: {
        title: "Roundtrip test",
        status: "INPROGRESS",
        dependencies: [1, 2]
      },
      description: "Description text",
      context: "Context text"
    };

    const filename = await createSubtask(
      TASK_FOLDER,
      original,
      DEVSFACTORY_DIR
    );
    const parsed = await parseSubtask(TASK_FOLDER, filename, DEVSFACTORY_DIR);

    expect(parsed.frontmatter.title).toBe(original.frontmatter.title);
    expect(parsed.frontmatter.status).toBe(original.frontmatter.status);
    expect(parsed.frontmatter.dependencies).toEqual(
      original.frontmatter.dependencies
    );
    expect(parsed.description).toContain("Description text");
    expect(parsed.context).toContain("Context text");
  });
});

describe("updateSubtaskStatus", () => {
  beforeEach(async () => {
    TEST_DIR = await createTestDir("subtask-status");
    DEVSFACTORY_DIR = `${TEST_DIR}/.devsfactory`;
    await Bun.$`mkdir -p ${DEVSFACTORY_DIR}/${TASK_FOLDER}`;
    await Bun.write(
      `${DEVSFACTORY_DIR}/${TASK_FOLDER}/001-test-subtask.md`,
      sampleSubtaskMarkdown
    );
  });

  afterEach(async () => {
    await cleanupTestDir(TEST_DIR);
  });

  test("changes only status", async () => {
    const original = await parseSubtask(
      TASK_FOLDER,
      "001-test-subtask.md",
      DEVSFACTORY_DIR
    );
    expect(original.frontmatter.status).toBe("PENDING");

    await updateSubtaskStatus(
      TASK_FOLDER,
      "001-test-subtask.md",
      "INPROGRESS",
      DEVSFACTORY_DIR
    );

    const updated = await parseSubtask(
      TASK_FOLDER,
      "001-test-subtask.md",
      DEVSFACTORY_DIR
    );

    expect(updated.frontmatter.status).toBe("INPROGRESS");
    expect(updated.frontmatter.title).toBe(original.frontmatter.title);
    expect(updated.frontmatter.dependencies).toEqual(
      original.frontmatter.dependencies
    );
    expect(updated.description).toBe(original.description);
  });

  test("throws on non-existent subtask", async () => {
    await expect(
      updateSubtaskStatus(
        TASK_FOLDER,
        "999-nonexistent.md",
        "DONE",
        DEVSFACTORY_DIR
      )
    ).rejects.toThrow();
  });
});

describe("listSubtasks", () => {
  beforeEach(async () => {
    TEST_DIR = await createTestDir("subtask-list");
    DEVSFACTORY_DIR = `${TEST_DIR}/.devsfactory`;
    await Bun.$`mkdir -p ${DEVSFACTORY_DIR}/${TASK_FOLDER}`;
  });

  afterEach(async () => {
    await cleanupTestDir(TEST_DIR);
  });

  test("finds all subtask files", async () => {
    await Bun.write(
      `${DEVSFACTORY_DIR}/${TASK_FOLDER}/001-first.md`,
      sampleSubtaskMarkdown
    );
    await Bun.write(
      `${DEVSFACTORY_DIR}/${TASK_FOLDER}/002-second.md`,
      sampleSubtaskMarkdown
    );
    await Bun.write(
      `${DEVSFACTORY_DIR}/${TASK_FOLDER}/003-third.md`,
      sampleSubtaskMarkdown
    );

    const subtasks = await listSubtasks(TASK_FOLDER, DEVSFACTORY_DIR);

    expect(subtasks).toHaveLength(3);
    expect(subtasks[0]!.filename).toBe("001-first.md");
    expect(subtasks[1]!.filename).toBe("002-second.md");
    expect(subtasks[2]!.filename).toBe("003-third.md");
  });

  test("excludes review files", async () => {
    await Bun.write(
      `${DEVSFACTORY_DIR}/${TASK_FOLDER}/001-subtask.md`,
      sampleSubtaskMarkdown
    );
    await Bun.write(
      `${DEVSFACTORY_DIR}/${TASK_FOLDER}/001-subtask-review.md`,
      "## Review #1\nReview content"
    );

    const subtasks = await listSubtasks(TASK_FOLDER, DEVSFACTORY_DIR);

    expect(subtasks).toHaveLength(1);
    expect(subtasks[0]!.filename).toBe("001-subtask.md");
  });

  test("returns sorted by number", async () => {
    await Bun.write(
      `${DEVSFACTORY_DIR}/${TASK_FOLDER}/003-third.md`,
      sampleSubtaskMarkdown
    );
    await Bun.write(
      `${DEVSFACTORY_DIR}/${TASK_FOLDER}/001-first.md`,
      sampleSubtaskMarkdown
    );
    await Bun.write(
      `${DEVSFACTORY_DIR}/${TASK_FOLDER}/002-second.md`,
      sampleSubtaskMarkdown
    );

    const subtasks = await listSubtasks(TASK_FOLDER, DEVSFACTORY_DIR);

    expect(subtasks[0]!.number).toBe(1);
    expect(subtasks[1]!.number).toBe(2);
    expect(subtasks[2]!.number).toBe(3);
  });

  test("returns empty array for folder with no subtasks", async () => {
    const subtasks = await listSubtasks(TASK_FOLDER, DEVSFACTORY_DIR);

    expect(subtasks).toEqual([]);
  });

  test("ignores non-subtask files", async () => {
    await Bun.write(
      `${DEVSFACTORY_DIR}/${TASK_FOLDER}/001-subtask.md`,
      sampleSubtaskMarkdown
    );
    await Bun.write(
      `${DEVSFACTORY_DIR}/${TASK_FOLDER}/task.md`,
      "task content"
    );
    await Bun.write(
      `${DEVSFACTORY_DIR}/${TASK_FOLDER}/plan.md`,
      "plan content"
    );
    await Bun.write(
      `${DEVSFACTORY_DIR}/${TASK_FOLDER}/notes.md`,
      "notes content"
    );

    const subtasks = await listSubtasks(TASK_FOLDER, DEVSFACTORY_DIR);

    expect(subtasks).toHaveLength(1);
    expect(subtasks[0]!.filename).toBe("001-subtask.md");
  });
});

describe("getReadySubtasks", () => {
  beforeEach(async () => {
    TEST_DIR = await createTestDir("subtask-ready");
    DEVSFACTORY_DIR = `${TEST_DIR}/.devsfactory`;
    await Bun.$`mkdir -p ${DEVSFACTORY_DIR}/${TASK_FOLDER}`;
  });

  afterEach(async () => {
    await cleanupTestDir(TEST_DIR);
  });

  test("returns only PENDING with satisfied deps", async () => {
    const subtask1 = `---
title: First subtask
status: DONE
dependencies: []
---

### Description
First subtask done
`;

    const subtask2 = `---
title: Second subtask
status: PENDING
dependencies:
  - 1
---

### Description
Second subtask depends on first
`;

    const subtask3 = `---
title: Third subtask
status: PENDING
dependencies:
  - 1
  - 2
---

### Description
Third depends on both
`;

    await Bun.write(`${DEVSFACTORY_DIR}/${TASK_FOLDER}/001-first.md`, subtask1);
    await Bun.write(
      `${DEVSFACTORY_DIR}/${TASK_FOLDER}/002-second.md`,
      subtask2
    );
    await Bun.write(`${DEVSFACTORY_DIR}/${TASK_FOLDER}/003-third.md`, subtask3);

    const ready = await getReadySubtasks(TASK_FOLDER, DEVSFACTORY_DIR);

    expect(ready).toHaveLength(1);
    expect(ready[0]!.number).toBe(2);
  });

  test("returns empty if all have unmet deps", async () => {
    const subtask1 = `---
title: First subtask
status: INPROGRESS
dependencies: []
---

### Description
First still in progress
`;

    const subtask2 = `---
title: Second subtask
status: PENDING
dependencies:
  - 1
---

### Description
Second depends on first
`;

    await Bun.write(`${DEVSFACTORY_DIR}/${TASK_FOLDER}/001-first.md`, subtask1);
    await Bun.write(
      `${DEVSFACTORY_DIR}/${TASK_FOLDER}/002-second.md`,
      subtask2
    );

    const ready = await getReadySubtasks(TASK_FOLDER, DEVSFACTORY_DIR);

    expect(ready).toEqual([]);
  });

  test("returns PENDING subtasks with no dependencies", async () => {
    const subtask1 = `---
title: First subtask
status: PENDING
dependencies: []
---

### Description
First has no deps
`;

    const subtask2 = `---
title: Second subtask
status: PENDING
dependencies: []
---

### Description
Second has no deps
`;

    await Bun.write(`${DEVSFACTORY_DIR}/${TASK_FOLDER}/001-first.md`, subtask1);
    await Bun.write(
      `${DEVSFACTORY_DIR}/${TASK_FOLDER}/002-second.md`,
      subtask2
    );

    const ready = await getReadySubtasks(TASK_FOLDER, DEVSFACTORY_DIR);

    expect(ready).toHaveLength(2);
  });

  test("excludes non-PENDING subtasks", async () => {
    const subtask1 = `---
title: First subtask
status: DONE
dependencies: []
---

### Description
Already done
`;

    const subtask2 = `---
title: Second subtask
status: INPROGRESS
dependencies: []
---

### Description
Already in progress
`;

    await Bun.write(`${DEVSFACTORY_DIR}/${TASK_FOLDER}/001-first.md`, subtask1);
    await Bun.write(
      `${DEVSFACTORY_DIR}/${TASK_FOLDER}/002-second.md`,
      subtask2
    );

    const ready = await getReadySubtasks(TASK_FOLDER, DEVSFACTORY_DIR);

    expect(ready).toEqual([]);
  });
});

describe("appendReviewHistory", () => {
  beforeEach(async () => {
    TEST_DIR = await createTestDir("subtask-review");
    DEVSFACTORY_DIR = `${TEST_DIR}/.devsfactory`;
    await Bun.$`mkdir -p ${DEVSFACTORY_DIR}/${TASK_FOLDER}`;
    await Bun.write(
      `${DEVSFACTORY_DIR}/${TASK_FOLDER}/001-subtask.md`,
      sampleSubtaskMarkdown
    );
  });

  afterEach(async () => {
    await cleanupTestDir(TEST_DIR);
  });

  test("creates new review file", async () => {
    await appendReviewHistory(
      TASK_FOLDER,
      "001-subtask.md",
      "- [ ] Fix validation\n- [ ] Add tests",
      DEVSFACTORY_DIR
    );

    const reviewFile = Bun.file(
      `${DEVSFACTORY_DIR}/${TASK_FOLDER}/001-subtask-review.md`
    );
    expect(await reviewFile.exists()).toBe(true);

    const content = await reviewFile.text();
    expect(content).toContain("## Review #1");
    expect(content).toContain("Fix validation");
    expect(content).toContain("Add tests");
  });

  test("appends to existing review file", async () => {
    await appendReviewHistory(
      TASK_FOLDER,
      "001-subtask.md",
      "- [ ] First issue",
      DEVSFACTORY_DIR
    );

    await appendReviewHistory(
      TASK_FOLDER,
      "001-subtask.md",
      "- [x] First issue (fixed)\n- [ ] New issue",
      DEVSFACTORY_DIR
    );

    const content = await Bun.file(
      `${DEVSFACTORY_DIR}/${TASK_FOLDER}/001-subtask-review.md`
    ).text();

    expect(content).toContain("## Review #1");
    expect(content).toContain("## Review #2");
    expect(content).toContain("First issue");
    expect(content).toContain("New issue");
  });

  test("increments review number", async () => {
    await appendReviewHistory(
      TASK_FOLDER,
      "001-subtask.md",
      "Review 1",
      DEVSFACTORY_DIR
    );
    await appendReviewHistory(
      TASK_FOLDER,
      "001-subtask.md",
      "Review 2",
      DEVSFACTORY_DIR
    );
    await appendReviewHistory(
      TASK_FOLDER,
      "001-subtask.md",
      "Review 3",
      DEVSFACTORY_DIR
    );

    const content = await Bun.file(
      `${DEVSFACTORY_DIR}/${TASK_FOLDER}/001-subtask-review.md`
    ).text();

    expect(content).toContain("## Review #1");
    expect(content).toContain("## Review #2");
    expect(content).toContain("## Review #3");
  });

  test("includes ISO timestamp in header", async () => {
    await appendReviewHistory(
      TASK_FOLDER,
      "001-subtask.md",
      "Review content",
      DEVSFACTORY_DIR
    );

    const content = await Bun.file(
      `${DEVSFACTORY_DIR}/${TASK_FOLDER}/001-subtask-review.md`
    ).text();

    // Check that header includes ISO timestamp pattern
    expect(content).toMatch(/## Review #1 - \d{4}-\d{2}-\d{2}T/);
  });
});

describe("updateSubtaskTiming", () => {
  beforeEach(async () => {
    TEST_DIR = await createTestDir("subtask-timing");
    DEVSFACTORY_DIR = `${TEST_DIR}/.devsfactory`;
    await Bun.$`mkdir -p ${DEVSFACTORY_DIR}/${TASK_FOLDER}`;
    await Bun.write(
      `${DEVSFACTORY_DIR}/${TASK_FOLDER}/001-test-subtask.md`,
      sampleSubtaskMarkdown
    );
  });

  afterEach(async () => {
    await cleanupTestDir(TEST_DIR);
  });

  test("sets startedAt timestamp", async () => {
    const startedAt = new Date("2026-01-27T10:00:00Z");

    await updateSubtaskTiming(
      TASK_FOLDER,
      "001-test-subtask.md",
      { startedAt },
      DEVSFACTORY_DIR
    );

    const updated = await parseSubtask(
      TASK_FOLDER,
      "001-test-subtask.md",
      DEVSFACTORY_DIR
    );

    expect(updated.frontmatter.timing?.startedAt).toEqual(startedAt);
  });

  test("sets completedAt and durationMs", async () => {
    const completedAt = new Date("2026-01-27T10:05:00Z");
    const durationMs = 300000;

    await updateSubtaskTiming(
      TASK_FOLDER,
      "001-test-subtask.md",
      { completedAt, durationMs },
      DEVSFACTORY_DIR
    );

    const updated = await parseSubtask(
      TASK_FOLDER,
      "001-test-subtask.md",
      DEVSFACTORY_DIR
    );

    expect(updated.frontmatter.timing?.completedAt).toEqual(completedAt);
    expect(updated.frontmatter.timing?.durationMs).toBe(durationMs);
  });

  test("merges with existing timing data", async () => {
    const startedAt = new Date("2026-01-27T10:00:00Z");
    const completedAt = new Date("2026-01-27T10:05:00Z");

    await updateSubtaskTiming(
      TASK_FOLDER,
      "001-test-subtask.md",
      { startedAt },
      DEVSFACTORY_DIR
    );

    await updateSubtaskTiming(
      TASK_FOLDER,
      "001-test-subtask.md",
      { completedAt },
      DEVSFACTORY_DIR
    );

    const updated = await parseSubtask(
      TASK_FOLDER,
      "001-test-subtask.md",
      DEVSFACTORY_DIR
    );

    expect(updated.frontmatter.timing?.startedAt).toEqual(startedAt);
    expect(updated.frontmatter.timing?.completedAt).toEqual(completedAt);
  });

  test("preserves other frontmatter fields", async () => {
    const original = await parseSubtask(
      TASK_FOLDER,
      "001-test-subtask.md",
      DEVSFACTORY_DIR
    );

    await updateSubtaskTiming(
      TASK_FOLDER,
      "001-test-subtask.md",
      { startedAt: new Date() },
      DEVSFACTORY_DIR
    );

    const updated = await parseSubtask(
      TASK_FOLDER,
      "001-test-subtask.md",
      DEVSFACTORY_DIR
    );

    expect(updated.frontmatter.title).toBe(original.frontmatter.title);
    expect(updated.frontmatter.status).toBe(original.frontmatter.status);
    expect(updated.frontmatter.dependencies).toEqual(
      original.frontmatter.dependencies
    );
    expect(updated.description).toBe(original.description);
  });

  test("handles file without existing timing gracefully", async () => {
    const subtaskWithoutTiming = `---
title: No timing subtask
status: PENDING
dependencies: []
---

### Description
A subtask without timing data.
`;
    await Bun.write(
      `${DEVSFACTORY_DIR}/${TASK_FOLDER}/002-no-timing.md`,
      subtaskWithoutTiming
    );

    await updateSubtaskTiming(
      TASK_FOLDER,
      "002-no-timing.md",
      { startedAt: new Date("2026-01-27T10:00:00Z") },
      DEVSFACTORY_DIR
    );

    const updated = await parseSubtask(
      TASK_FOLDER,
      "002-no-timing.md",
      DEVSFACTORY_DIR
    );

    expect(updated.frontmatter.timing?.startedAt).toEqual(
      new Date("2026-01-27T10:00:00Z")
    );
  });

  test("throws on non-existent file", async () => {
    await expect(
      updateSubtaskTiming(
        TASK_FOLDER,
        "999-nonexistent.md",
        { startedAt: new Date() },
        DEVSFACTORY_DIR
      )
    ).rejects.toThrow();
  });
});

describe("recordPhaseDuration", () => {
  beforeEach(async () => {
    TEST_DIR = await createTestDir("subtask-phase");
    DEVSFACTORY_DIR = `${TEST_DIR}/.devsfactory`;
    await Bun.$`mkdir -p ${DEVSFACTORY_DIR}/${TASK_FOLDER}`;
    await Bun.write(
      `${DEVSFACTORY_DIR}/${TASK_FOLDER}/001-test-subtask.md`,
      sampleSubtaskMarkdown
    );
  });

  afterEach(async () => {
    await cleanupTestDir(TEST_DIR);
  });

  test("records implementation phase duration", async () => {
    await recordPhaseDuration(
      TASK_FOLDER,
      "001-test-subtask.md",
      "implementation",
      120000,
      DEVSFACTORY_DIR
    );

    const updated = await parseSubtask(
      TASK_FOLDER,
      "001-test-subtask.md",
      DEVSFACTORY_DIR
    );

    expect(updated.frontmatter.timing?.phases.implementation).toBe(120000);
  });

  test("records review phase duration", async () => {
    await recordPhaseDuration(
      TASK_FOLDER,
      "001-test-subtask.md",
      "review",
      60000,
      DEVSFACTORY_DIR
    );

    const updated = await parseSubtask(
      TASK_FOLDER,
      "001-test-subtask.md",
      DEVSFACTORY_DIR
    );

    expect(updated.frontmatter.timing?.phases.review).toBe(60000);
  });

  test("records multiple phases independently", async () => {
    await recordPhaseDuration(
      TASK_FOLDER,
      "001-test-subtask.md",
      "implementation",
      120000,
      DEVSFACTORY_DIR
    );

    await recordPhaseDuration(
      TASK_FOLDER,
      "001-test-subtask.md",
      "review",
      30000,
      DEVSFACTORY_DIR
    );

    await recordPhaseDuration(
      TASK_FOLDER,
      "001-test-subtask.md",
      "merge",
      5000,
      DEVSFACTORY_DIR
    );

    const updated = await parseSubtask(
      TASK_FOLDER,
      "001-test-subtask.md",
      DEVSFACTORY_DIR
    );

    expect(updated.frontmatter.timing?.phases.implementation).toBe(120000);
    expect(updated.frontmatter.timing?.phases.review).toBe(30000);
    expect(updated.frontmatter.timing?.phases.merge).toBe(5000);
    expect(updated.frontmatter.timing?.phases.conflictSolver).toBeNull();
  });

  test("preserves existing timing data when adding phase", async () => {
    await updateSubtaskTiming(
      TASK_FOLDER,
      "001-test-subtask.md",
      { startedAt: new Date("2026-01-27T10:00:00Z") },
      DEVSFACTORY_DIR
    );

    await recordPhaseDuration(
      TASK_FOLDER,
      "001-test-subtask.md",
      "implementation",
      120000,
      DEVSFACTORY_DIR
    );

    const updated = await parseSubtask(
      TASK_FOLDER,
      "001-test-subtask.md",
      DEVSFACTORY_DIR
    );

    expect(updated.frontmatter.timing?.startedAt).toEqual(
      new Date("2026-01-27T10:00:00Z")
    );
    expect(updated.frontmatter.timing?.phases.implementation).toBe(120000);
  });

  test("throws on non-existent file", async () => {
    await expect(
      recordPhaseDuration(
        TASK_FOLDER,
        "999-nonexistent.md",
        "implementation",
        120000,
        DEVSFACTORY_DIR
      )
    ).rejects.toThrow();
  });

  test("timing roundtrip: write -> read preserves all values", async () => {
    const startedAt = new Date("2026-01-27T10:00:00Z");
    const completedAt = new Date("2026-01-27T10:30:00Z");
    const durationMs = 1800000;

    await updateSubtaskTiming(
      TASK_FOLDER,
      "001-test-subtask.md",
      { startedAt, completedAt, durationMs },
      DEVSFACTORY_DIR
    );

    await recordPhaseDuration(
      TASK_FOLDER,
      "001-test-subtask.md",
      "implementation",
      1200000,
      DEVSFACTORY_DIR
    );

    await recordPhaseDuration(
      TASK_FOLDER,
      "001-test-subtask.md",
      "review",
      600000,
      DEVSFACTORY_DIR
    );

    const parsed = await parseSubtask(
      TASK_FOLDER,
      "001-test-subtask.md",
      DEVSFACTORY_DIR
    );

    expect(parsed.frontmatter.timing?.startedAt).toEqual(startedAt);
    expect(parsed.frontmatter.timing?.completedAt).toEqual(completedAt);
    expect(parsed.frontmatter.timing?.durationMs).toBe(durationMs);
    expect(parsed.frontmatter.timing?.phases.implementation).toBe(1200000);
    expect(parsed.frontmatter.timing?.phases.review).toBe(600000);
    expect(parsed.frontmatter.timing?.phases.merge).toBeNull();
    expect(parsed.frontmatter.timing?.phases.conflictSolver).toBeNull();
  });
});
