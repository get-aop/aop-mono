import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { cleanupTestDir, createTestDir } from "../test-helpers";
import type { Config } from "../types";
import { DevsfactoryWatcher } from "./watcher";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const createConfig = (overrides: Partial<Config> = {}): Config => ({
  maxConcurrentAgents: 3,
  devsfactoryDir: ".devsfactory",
  worktreesDir: ".worktrees",
  dashboardPort: 3001,
  debounceMs: 50,
  retryBackoff: { initialMs: 2000, maxMs: 300000, maxAttempts: 5 },
  ignorePatterns: [".git", "*.swp", "*.tmp", "*~", ".DS_Store"],
  ...overrides
});

const TASK_CONTENT = `---
title: Test Task
status: PENDING
created: 2026-01-01
priority: medium
---

## Description
Test description

## Requirements
Test requirements

## Acceptance Criteria
- [ ] First criterion
`;

const PLAN_CONTENT = `---
status: INPROGRESS
task: my-task
created: 2026-01-01
---

## Subtasks
1. 001-first (First subtask)
`;

const SUBTASK_CONTENT = `---
title: First subtask
status: PENDING
dependencies: []
---

### Description
Subtask description
`;

// Tests that don't require starting the watcher (no fs.watch cleanup issues)
describe("DevsfactoryWatcher", () => {
  describe("lifecycle (no watching)", () => {
    test("extends EventEmitter", () => {
      const watcher = new DevsfactoryWatcher(createConfig());
      expect(watcher).toBeInstanceOf(EventEmitter);
    });

    test("isWatching returns false initially", () => {
      const watcher = new DevsfactoryWatcher(createConfig());
      expect(watcher.isWatching()).toBe(false);
    });
  });

  describe("scan()", () => {
    let tempDir: string;
    let devsfactoryDir: string;
    let taskDir: string;
    let watcher: DevsfactoryWatcher;
    const taskFolder = "my-task";

    beforeEach(async () => {
      tempDir = await createTestDir("watcher-scan");
      devsfactoryDir = join(tempDir, ".devsfactory");
      taskDir = join(devsfactoryDir, taskFolder);
      await mkdir(taskDir, { recursive: true });
      watcher = new DevsfactoryWatcher(createConfig());
    });

    afterEach(async () => {
      await cleanupTestDir(tempDir);
    });

    test("returns empty results for empty directory", async () => {
      await rm(taskDir, { recursive: true, force: true });
      const result = await watcher.scan(devsfactoryDir);

      expect(result.tasks).toEqual([]);
      expect(result.plans).toEqual({});
      expect(result.subtasks).toEqual({});
    });

    test("handles missing plan.md gracefully", async () => {
      await writeFile(join(taskDir, "task.md"), TASK_CONTENT);

      const result = await watcher.scan(devsfactoryDir);

      expect(result.tasks.length).toBe(1);
      expect(result.plans[taskFolder]).toBeUndefined();
    });

    test("returns all tasks, plans, and subtasks", async () => {
      await writeFile(join(taskDir, "task.md"), TASK_CONTENT);
      await writeFile(join(taskDir, "plan.md"), PLAN_CONTENT);
      await writeFile(join(taskDir, "001-first.md"), SUBTASK_CONTENT);

      const result = await watcher.scan(devsfactoryDir);

      expect(result.tasks.length).toBe(1);
      expect(result.tasks[0]!.folder).toBe(taskFolder);
      expect(result.tasks[0]!.frontmatter.title).toBe("Test Task");

      expect(result.plans[taskFolder]).toBeDefined();
      expect(result.plans[taskFolder]!.frontmatter.status).toBe("INPROGRESS");

      expect(result.subtasks[taskFolder]).toBeDefined();
      expect(result.subtasks[taskFolder]!.length).toBe(1);
      expect(result.subtasks[taskFolder]![0]!.frontmatter.title).toBe(
        "First subtask"
      );
    });
  });
});

// Tests that require starting the watcher
// Skip on CI: fs.watch with recursive:true on Linux doesn't release inotify handles
// properly, causing directory cleanup to hang indefinitely
const isCI = !!process.env.CI;
describe.skipIf(isCI)("DevsfactoryWatcher (with watching)", () => {
  let tempDir: string;
  let devsfactoryDir: string;
  let taskDir: string;
  let watcher: DevsfactoryWatcher;
  const taskFolder = "my-task";

  beforeEach(async () => {
    tempDir = await createTestDir("watcher-live");
    devsfactoryDir = join(tempDir, ".devsfactory");
    taskDir = join(devsfactoryDir, taskFolder);
    await mkdir(taskDir, { recursive: true });
    watcher = new DevsfactoryWatcher(createConfig({ debounceMs: 10 }));
  });

  afterEach(async () => {
    watcher.stop();
    // Longer delay to ensure inotify file handles are released on Linux
    await sleep(100);
    await cleanupTestDir(tempDir);
  });

  describe("lifecycle", () => {
    test("start() begins watching", () => {
      expect(watcher.isWatching()).toBe(false);
      watcher.start(devsfactoryDir);
      expect(watcher.isWatching()).toBe(true);
    });

    test("stop() stops watching", () => {
      watcher.start(devsfactoryDir);
      watcher.stop();
      expect(watcher.isWatching()).toBe(false);
    });

    test("can restart after stopping", async () => {
      watcher.start(devsfactoryDir);
      watcher.stop();
      await sleep(50);
      watcher.start(devsfactoryDir);
      expect(watcher.isWatching()).toBe(true);
    });
  });

  describe("event emission", () => {
    test("emits taskChanged when task.md is modified", async () => {
      await writeFile(join(taskDir, "task.md"), "initial");
      const events: Array<{ taskFolder: string }> = [];
      watcher.on("taskChanged", (e) => events.push(e));
      watcher.start(devsfactoryDir);

      await sleep(50);
      await writeFile(join(taskDir, "task.md"), "modified");
      await sleep(100);

      expect(events.length).toBeGreaterThanOrEqual(1);
      expect(events[0]!.taskFolder).toBe(taskFolder);
    });

    test("emits planChanged when plan.md is modified", async () => {
      await writeFile(join(taskDir, "plan.md"), "initial");
      const events: Array<{ taskFolder: string }> = [];
      watcher.on("planChanged", (e) => events.push(e));
      watcher.start(devsfactoryDir);

      await sleep(50);
      await writeFile(join(taskDir, "plan.md"), "modified");
      await sleep(100);

      expect(events.length).toBeGreaterThanOrEqual(1);
      expect(events[0]!.taskFolder).toBe(taskFolder);
    });

    test("emits subtaskChanged when NNN-*.md is modified", async () => {
      await writeFile(join(taskDir, "001-first-subtask.md"), "initial");
      const events: Array<{ taskFolder: string; filename: string }> = [];
      watcher.on("subtaskChanged", (e) => events.push(e));
      watcher.start(devsfactoryDir);

      await sleep(50);
      await writeFile(join(taskDir, "001-first-subtask.md"), "modified");
      await sleep(100);

      expect(events.length).toBeGreaterThanOrEqual(1);
      expect(events[0]!.taskFolder).toBe(taskFolder);
      expect(events[0]!.filename).toBe("001-first-subtask.md");
    });

    test("emits reviewChanged when review.md is modified", async () => {
      await writeFile(join(taskDir, "review.md"), "initial");
      const events: Array<{ taskFolder: string }> = [];
      watcher.on("reviewChanged", (e) => events.push(e));
      watcher.start(devsfactoryDir);

      await sleep(50);
      await writeFile(join(taskDir, "review.md"), "modified");
      await sleep(100);

      expect(events.length).toBeGreaterThanOrEqual(1);
      expect(events[0]!.taskFolder).toBe(taskFolder);
    });
  });

  describe("debouncing", () => {
    test("multiple rapid changes emit single event", async () => {
      watcher.stop();
      await sleep(50);
      watcher = new DevsfactoryWatcher(createConfig({ debounceMs: 50 }));
      await writeFile(join(taskDir, "task.md"), "initial");
      const events: Array<{ taskFolder: string }> = [];
      watcher.on("taskChanged", (e) => events.push(e));
      watcher.start(devsfactoryDir);

      // Wait longer than debounce time to flush any startup events
      await sleep(100);
      events.length = 0; // Clear any events from watcher startup

      await writeFile(join(taskDir, "task.md"), "change1");
      await writeFile(join(taskDir, "task.md"), "change2");
      await writeFile(join(taskDir, "task.md"), "change3");
      await sleep(150);

      expect(events.length).toBe(1);
    });

    test("different files debounce independently", async () => {
      await writeFile(join(taskDir, "task.md"), "initial");
      await writeFile(join(taskDir, "plan.md"), "initial");
      const taskEvents: Array<{ taskFolder: string }> = [];
      const planEvents: Array<{ taskFolder: string }> = [];
      watcher.on("taskChanged", (e) => taskEvents.push(e));
      watcher.on("planChanged", (e) => planEvents.push(e));
      watcher.start(devsfactoryDir);

      await sleep(50);
      await writeFile(join(taskDir, "task.md"), "changed task");
      await sleep(10);
      await writeFile(join(taskDir, "plan.md"), "changed plan");
      await sleep(100);

      expect(taskEvents.length).toBe(1);
      expect(planEvents.length).toBe(1);
    });
  });

  describe("filtering", () => {
    const expectNoEvents = async (filename: string) => {
      let eventCount = 0;
      watcher.on("taskChanged", () => eventCount++);
      watcher.on("planChanged", () => eventCount++);
      watcher.on("subtaskChanged", () => eventCount++);
      watcher.on("reviewChanged", () => eventCount++);
      watcher.start(devsfactoryDir);

      await sleep(50);
      await writeFile(join(taskDir, filename), "content");
      await sleep(100);

      expect(eventCount).toBe(0);
    };

    test("ignores *.swp files", async () => {
      await expectNoEvents("task.md.swp");
    });

    test("ignores *.tmp files", async () => {
      await expectNoEvents("file.tmp");
    });

    test("ignores files ending with ~", async () => {
      await expectNoEvents("task.md~");
    });

    test("ignores .DS_Store", async () => {
      await expectNoEvents(".DS_Store");
    });

    test("ignores .git directory changes", async () => {
      const gitDir = join(taskDir, ".git");
      await mkdir(gitDir, { recursive: true });

      let eventCount = 0;
      watcher.on("taskChanged", () => eventCount++);
      watcher.on("planChanged", () => eventCount++);
      watcher.on("subtaskChanged", () => eventCount++);
      watcher.on("reviewChanged", () => eventCount++);
      watcher.start(devsfactoryDir);

      await sleep(50);
      await writeFile(join(gitDir, "config"), "git config");
      await sleep(100);

      expect(eventCount).toBe(0);
    });
  });
});
