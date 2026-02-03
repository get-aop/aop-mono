import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestRepo, createTestTask } from "../db/test-utils.ts";
import type { ServerSync } from "../sync/server-sync.ts";
import { createMockServerSync } from "../sync/test-utils.ts";
import { createDaemon } from "./daemon.ts";

describe("Daemon Queue Processor Integration", () => {
  let testDir: string;
  let testDbPath: string;
  let testPidFile: string;
  let daemon: ReturnType<typeof createDaemon> | null = null;

  beforeEach(async () => {
    testDir = join(tmpdir(), `daemon-queue-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
    testDbPath = join(testDir, "test.db");
    testPidFile = join(testDir, "test.pid");

    const repoDir = join(testDir, "repo");
    const changesDir = join(repoDir, "openspec/changes");
    mkdirSync(changesDir, { recursive: true });
  });

  afterEach(async () => {
    if (daemon?.isRunning()) {
      await daemon.stop();
    }
    daemon = null;
    await Bun.sleep(100);
    rmSync(testDir, { recursive: true, force: true });
  });

  test("queue processor executes ready task with valid step", async () => {
    const { createDatabase } = await import("../db/connection.ts");
    const db = createDatabase(testDbPath);
    const { runMigrations } = await import("../db/migrations.ts");
    await runMigrations(db);

    const repoPath = join(testDir, "repo");
    await createTestRepo(db, "repo-queue", repoPath);

    const changePath = join(repoPath, "openspec/changes/feature-exec");
    mkdirSync(changePath, { recursive: true });
    writeFileSync(join(changePath, "proposal.md"), "# Test");
    await createTestTask(db, "task-exec", "repo-queue", changePath, "READY");

    await db.destroy();

    let executeTaskCalled = false;
    const mockSync: ServerSync = {
      ...createMockServerSync(),
      markTaskReady: async (taskId: string) => {
        executeTaskCalled = true;
        return {
          status: "WORKING" as const,
          execution: { id: `exec_${taskId}`, workflowId: "wf_test" },
          step: {
            id: `step_${taskId}`,
            type: "implement",
            promptTemplate: "Test prompt",
            attempt: 1,
          },
        };
      },
    };

    daemon = createDaemon({
      dbPath: testDbPath,
      pidFile: testPidFile,
      serverSync: mockSync,
    });

    await daemon.start();
    await Bun.sleep(2000);

    expect(executeTaskCalled).toBe(true);
  });

  test("queue processor handles task execution errors gracefully", async () => {
    const { createDatabase } = await import("../db/connection.ts");
    const db = createDatabase(testDbPath);
    const { runMigrations } = await import("../db/migrations.ts");
    await runMigrations(db);

    const repoPath = join(testDir, "repo");
    await createTestRepo(db, "repo-error", repoPath);

    const changePath = join(repoPath, "openspec/changes/feature-error");
    mkdirSync(changePath, { recursive: true });
    writeFileSync(join(changePath, "proposal.md"), "# Test Error");
    await createTestTask(db, "task-error", "repo-error", changePath, "READY");

    await db.destroy();

    const mockSync: ServerSync = {
      ...createMockServerSync(),
      markTaskReady: async (taskId: string) => {
        return {
          status: "WORKING" as const,
          execution: { id: `exec_${taskId}`, workflowId: "wf_error" },
          step: {
            id: `step_${taskId}`,
            type: "implement",
            promptTemplate: "Will fail",
            attempt: 1,
          },
        };
      },
    };

    daemon = createDaemon({
      dbPath: testDbPath,
      pidFile: testPidFile,
      serverSync: mockSync,
    });

    await daemon.start();
    await Bun.sleep(2000);
    expect(daemon.isRunning()).toBe(true);
  });
});
