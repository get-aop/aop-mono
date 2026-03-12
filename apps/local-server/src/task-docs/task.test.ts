import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TaskStatus } from "@aop/common";
import { parseTaskDoc, writeTaskDoc } from "./task.ts";

describe("task-docs/task", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "aop-task-doc-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("round-trips Linear source metadata and dependency mirror metadata", async () => {
    const taskDir = join(tempDir, "task");
    const taskFilePath = join(taskDir, "task.md");
    await mkdir(taskDir, { recursive: true });

    await writeTaskDoc(
      taskFilePath,
      {
        id: "task-linear-1",
        title: "Imported issue",
        status: TaskStatus.DRAFT,
        created: "2026-03-12T12:00:00.000Z",
        source: {
          provider: "linear",
          id: "lin_123",
          ref: "ABC-123",
          url: "https://linear.app/acme/issue/ABC-123/imported-issue",
        },
        dependencySources: [
          {
            provider: "linear",
            id: "lin_120",
            ref: "ABC-120",
          },
        ],
        dependencyImported: true,
      },
      [
        "",
        "## Description",
        "Imported from Linear",
        "",
        "## Requirements",
        "- Review the Linear issue",
        "",
        "## Acceptance Criteria",
        "- [ ] Match the ticket intent",
        "",
      ].join("\n"),
    );

    const doc = await parseTaskDoc(taskFilePath);

    expect(doc.source).toEqual({
      provider: "linear",
      id: "lin_123",
      ref: "ABC-123",
      url: "https://linear.app/acme/issue/ABC-123/imported-issue",
    });
    expect(doc.dependencySources).toEqual([
      {
        provider: "linear",
        id: "lin_120",
        ref: "ABC-120",
      },
    ]);
    expect(doc.dependencyImported).toBe(true);
  });
});
