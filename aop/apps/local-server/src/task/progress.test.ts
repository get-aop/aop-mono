import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { aopPaths } from "@aop/infra";
import { parseTaskProgress, readTaskProgress } from "./progress.ts";

describe("parseTaskProgress", () => {
  test("all incomplete", () => {
    const content = "## Tasks\n- [ ] Task A\n- [ ] Task B\n- [ ] Task C";
    expect(parseTaskProgress(content)).toEqual({ completed: 0, total: 3 });
  });

  test("mixed completion", () => {
    const content = "## Tasks\n- [x] Task A\n- [ ] Task B\n- [x] Task C";
    expect(parseTaskProgress(content)).toEqual({ completed: 2, total: 3 });
  });

  test("all complete", () => {
    const content = "- [x] Task 1\n- [x] Task 2\n- [x] Task 3\n- [x] Task 4\n- [x] Task 5";
    expect(parseTaskProgress(content)).toEqual({ completed: 5, total: 5 });
  });

  test("empty file", () => {
    expect(parseTaskProgress("")).toEqual({ completed: 0, total: 0 });
  });

  test("no checkboxes", () => {
    const content = "## Design\nSome text\n- bullet point\n- another bullet";
    expect(parseTaskProgress(content)).toEqual({ completed: 0, total: 0 });
  });

  test("handles uppercase X", () => {
    const content = "- [X] Task A\n- [ ] Task B";
    expect(parseTaskProgress(content)).toEqual({ completed: 1, total: 2 });
  });

  test("ignores non-checkbox lines with brackets", () => {
    const content = "Some [text] here\n- [x] Real task\n[not a task]";
    expect(parseTaskProgress(content)).toEqual({ completed: 1, total: 1 });
  });

  test("handles indented checkboxes", () => {
    const content = "## Section\n  - [x] Sub-task A\n  - [ ] Sub-task B\n- [x] Top-level";
    expect(parseTaskProgress(content)).toEqual({ completed: 2, total: 3 });
  });
});

describe("readTaskProgress", () => {
  const repoId = "test-repo-progress";
  const changePath = "openspec/changes/test-change";
  const changeDir = join(aopPaths.repoDir(repoId), changePath);

  beforeEach(() => {
    mkdirSync(changeDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(aopPaths.repoDir(repoId), { recursive: true, force: true });
  });

  test("reads progress from tasks.md", () => {
    writeFileSync(join(changeDir, "tasks.md"), "- [x] Done\n- [ ] Not done\n- [x] Also done");
    expect(readTaskProgress(repoId, changePath)).toEqual({ completed: 2, total: 3 });
  });

  test("returns undefined when tasks.md is missing", () => {
    expect(readTaskProgress(repoId, changePath)).toBeUndefined();
  });

  test("returns undefined for nonexistent repo", () => {
    expect(readTaskProgress("nonexistent-repo", changePath)).toBeUndefined();
  });
});
