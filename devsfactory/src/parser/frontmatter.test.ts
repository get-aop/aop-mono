import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { ZodError, z } from "zod";
import { SubtaskFrontmatterSchema, TaskFrontmatterSchema } from "../types";
import {
  parseFrontmatter,
  safeParseFrontmatter,
  serializeFrontmatter,
  updateFrontmatter,
} from "./frontmatter";

const SimpleSchema = z.object({
  title: z.string(),
  count: z.number(),
});

describe("parseFrontmatter", () => {
  test("parses valid frontmatter with simple schema", () => {
    const markdown = `---
title: Test
count: 42
---
# Content here`;

    const result = parseFrontmatter(markdown, SimpleSchema);

    expect(result.frontmatter).toEqual({ title: "Test", count: 42 });
    expect(result.content).toBe("# Content here");
  });

  test("parses TaskFrontmatterSchema with dates", () => {
    const markdown = `---
title: My Task
status: PENDING
created: 2026-01-25
priority: high
tags:
  - feature
  - urgent
assignee: null
dependencies: []
---
Task description here.`;

    const result = parseFrontmatter(markdown, TaskFrontmatterSchema);

    expect(result.frontmatter.title).toBe("My Task");
    expect(result.frontmatter.status).toBe("PENDING");
    expect(result.frontmatter.created).toBeInstanceOf(Date);
    expect(result.frontmatter.priority).toBe("high");
    expect(result.frontmatter.tags).toEqual(["feature", "urgent"]);
  });

  test("parses SubtaskFrontmatterSchema with numeric dependencies", () => {
    const markdown = `---
title: Implement feature
status: PENDING
dependencies: [1, 2]
---
Subtask details.`;

    const result = parseFrontmatter(markdown, SubtaskFrontmatterSchema);

    expect(result.frontmatter.title).toBe("Implement feature");
    expect(result.frontmatter.status).toBe("PENDING");
    expect(result.frontmatter.dependencies).toEqual([1, 2]);
  });

  test("throws on missing frontmatter delimiters", () => {
    const markdown = `title: Test
count: 42
# Content`;

    expect(() => parseFrontmatter(markdown, SimpleSchema)).toThrow(
      "Invalid frontmatter",
    );
  });

  test("throws on invalid schema", () => {
    const markdown = `---
title: Test
count: not-a-number
---
Content`;

    expect(() => parseFrontmatter(markdown, SimpleSchema)).toThrow();
  });

  test("throws ZodError with helpful message for invalid field values", () => {
    const markdown = `---
title: Test
count: invalid-number
---
Content`;

    try {
      parseFrontmatter(markdown, SimpleSchema);
      expect.unreachable("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ZodError);
      const zodError = error as ZodError;
      expect(zodError.issues.length).toBeGreaterThan(0);
      const firstIssue = zodError.issues[0]!;
      expect(firstIssue.path).toContain("count");
      expect(firstIssue.message).toBeDefined();
    }
  });

  test("handles empty content after frontmatter", () => {
    const markdown = `---
title: Test
count: 1
---
`;

    const result = parseFrontmatter(markdown, SimpleSchema);

    expect(result.frontmatter).toEqual({ title: "Test", count: 1 });
    expect(result.content).toBe("");
  });

  test("handles Windows line endings (CRLF)", () => {
    const markdown = "---\r\ntitle: Test\r\ncount: 1\r\n---\r\nContent";

    const result = parseFrontmatter(markdown, SimpleSchema);

    expect(result.frontmatter).toEqual({ title: "Test", count: 1 });
    expect(result.content).toBe("Content");
  });
});

describe("safeParseFrontmatter", () => {
  test("returns success with valid input", () => {
    const markdown = `---
title: Test
count: 42
---
Content`;

    const result = safeParseFrontmatter(markdown, SimpleSchema);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.frontmatter).toEqual({ title: "Test", count: 42 });
      expect(result.data.content).toBe("Content");
    }
  });

  test("returns error with invalid schema data", () => {
    const markdown = `---
title: Test
count: invalid
---
Content`;

    const result = safeParseFrontmatter(markdown, SimpleSchema);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeDefined();
      expect(result.error.issues.length).toBeGreaterThan(0);
    }
  });

  test("returns error on malformed frontmatter structure", () => {
    const markdown = "no frontmatter";

    const result = safeParseFrontmatter(markdown, SimpleSchema);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(ZodError);
      expect(result.error.issues[0]!.code).toBe("invalid_format");
      expect(result.error.issues[0]!.message).toContain("Invalid frontmatter");
    }
  });

  test("allows distinguishing structure errors via custom issue code", () => {
    const malformedStructure = "no frontmatter";
    const invalidSchema = `---
title: Test
count: not-a-number
---
Content`;

    const structureResult = safeParseFrontmatter(
      malformedStructure,
      SimpleSchema,
    );
    const schemaResult = safeParseFrontmatter(invalidSchema, SimpleSchema);

    expect(structureResult.success).toBe(false);
    expect(schemaResult.success).toBe(false);

    if (!structureResult.success && !schemaResult.success) {
      expect(structureResult.error.issues[0]!.code).toBe("invalid_format");
      expect(schemaResult.error.issues[0]!.code).not.toBe("invalid_format");
    }
  });
});

describe("serializeFrontmatter", () => {
  test("serializes simple frontmatter", () => {
    const doc = {
      frontmatter: { title: "Test", count: 42 },
      content: "# Content",
    };

    const result = serializeFrontmatter(doc);

    expect(result).toBe(`---
title: Test
count: 42
---
# Content`);
  });

  test("serializes Date objects as ISO strings", () => {
    const date = new Date("2026-01-25T10:30:00.000Z");
    const doc = {
      frontmatter: { title: "Test", created: date },
      content: "Content",
    };

    const result = serializeFrontmatter(doc);

    expect(result).toContain("created: 2026-01-25T10:30:00.000Z");
  });

  test("serializes arrays correctly", () => {
    const doc = {
      frontmatter: { title: "Test", tags: ["a", "b", "c"] },
      content: "Content",
    };

    const result = serializeFrontmatter(doc);

    expect(result).toContain("tags:");
    expect(result).toContain("- a");
    expect(result).toContain("- b");
    expect(result).toContain("- c");
  });

  test("serializes nested objects", () => {
    const doc = {
      frontmatter: { title: "Test", meta: { author: "John", version: 1 } },
      content: "Content",
    };

    const result = serializeFrontmatter(doc);

    expect(result).toContain("meta:");
    expect(result).toContain("author: John");
    expect(result).toContain("version: 1");
  });

  test("handles null values", () => {
    const doc = {
      frontmatter: { title: "Test", assignee: null },
      content: "Content",
    };

    const result = serializeFrontmatter(doc);

    expect(result).toContain("assignee: null");
  });

  test("roundtrip: parse -> serialize -> parse", () => {
    const original = `---
title: Roundtrip Test
count: 99
---
Original content stays intact.`;

    const parsed = parseFrontmatter(original, SimpleSchema);
    const serialized = serializeFrontmatter(parsed);
    const reparsed = parseFrontmatter(serialized, SimpleSchema);

    expect(reparsed.frontmatter).toEqual(parsed.frontmatter);
    expect(reparsed.content).toBe(parsed.content);
  });
});

describe("updateFrontmatter", () => {
  const testFilePath = `/tmp/frontmatter-test-${Date.now()}-${Math.random()}.md`;

  beforeEach(async () => {
    const content = `---
title: Original
count: 1
---
File content`;
    await Bun.write(testFilePath, content);
  });

  afterEach(async () => {
    try {
      const file = Bun.file(testFilePath);
      if (await file.exists()) {
        await Bun.$`rm ${testFilePath}`;
      }
    } catch {
      // ignore cleanup errors
    }
  });

  test("updates frontmatter in existing file", async () => {
    await updateFrontmatter(testFilePath, SimpleSchema, (current) => ({
      ...current,
      count: current.count + 1,
    }));

    const updated = await Bun.file(testFilePath).text();
    const parsed = parseFrontmatter(updated, SimpleSchema);

    expect(parsed.frontmatter.count).toBe(2);
    expect(parsed.frontmatter.title).toBe("Original");
    expect(parsed.content).toBe("File content");
  });

  test("replaces frontmatter values", async () => {
    await updateFrontmatter(testFilePath, SimpleSchema, (current) => ({
      ...current,
      title: "Updated Title",
    }));

    const updated = await Bun.file(testFilePath).text();
    const parsed = parseFrontmatter(updated, SimpleSchema);

    expect(parsed.frontmatter.title).toBe("Updated Title");
  });

  test("throws on non-existent file", async () => {
    const nonExistentPath = `/tmp/does-not-exist-${Date.now()}.md`;

    await expect(
      updateFrontmatter(nonExistentPath, SimpleSchema, (current) => current),
    ).rejects.toThrow("File not found");
  });
});

describe("integration with project schemas", () => {
  test("full TaskFrontmatter roundtrip", () => {
    const original = `---
title: Build feature X
status: INPROGRESS
created: 2026-01-25T12:00:00.000Z
priority: high
tags:
  - backend
  - api
assignee: claude
dependencies:
  - task-001
---
## Description
This task involves building feature X.`;

    const parsed = parseFrontmatter(original, TaskFrontmatterSchema);

    expect(parsed.frontmatter.title).toBe("Build feature X");
    expect(parsed.frontmatter.status).toBe("INPROGRESS");
    expect(parsed.frontmatter.priority).toBe("high");
    expect(parsed.frontmatter.tags).toEqual(["backend", "api"]);
    expect(parsed.frontmatter.assignee).toBe("claude");

    const serialized = serializeFrontmatter(parsed);
    const reparsed = parseFrontmatter(serialized, TaskFrontmatterSchema);

    expect(reparsed.frontmatter.title).toBe(parsed.frontmatter.title);
    expect(reparsed.frontmatter.status).toBe(parsed.frontmatter.status);
    expect(reparsed.content).toBe(parsed.content);
  });

  test("SubtaskFrontmatter with defaults", () => {
    const minimal = `---
title: Simple subtask
status: PENDING
---
Details`;

    const parsed = parseFrontmatter(minimal, SubtaskFrontmatterSchema);

    expect(parsed.frontmatter.title).toBe("Simple subtask");
    expect(parsed.frontmatter.status).toBe("PENDING");
    expect(parsed.frontmatter.dependencies).toEqual([]);
  });

  test("throws ZodError with helpful message for invalid enum value", () => {
    const markdown = `---
title: Task
status: INVALID_STATUS
created: 2026-01-25
priority: high
---
Content`;

    try {
      parseFrontmatter(markdown, TaskFrontmatterSchema);
      expect.unreachable("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ZodError);
      const zodError = error as ZodError;
      const firstIssue = zodError.issues[0]!;
      expect(firstIssue.path).toContain("status");
      expect(firstIssue.code).toBe("invalid_enum_value");
    }
  });
});
