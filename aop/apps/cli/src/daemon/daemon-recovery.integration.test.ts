import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestRepo, createTestTask } from "../db/test-utils.ts";
import { createExecutionRepository } from "../executions/repository.ts";
import { ExecutionStatus, StepExecutionStatus } from "../executions/types.ts";
import type { ServerSync } from "../sync/server-sync.ts";
import { createMockServerSync } from "../sync/test-utils.ts";
import { createDaemon } from "./daemon.ts";

describe("Daemon Task Recovery Integration", () => {
  let testDir: string;
  let testDbPath: string;
  let testPidFile: string;
  let daemon: ReturnType<typeof createDaemon> | null = null;

  beforeEach(async () => {
    testDir = join(
      tmpdir(),
      `daemon-recovery-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(testDir, { recursive: true });
    testDbPath = join(testDir, "test.db");
    testPidFile = join(testDir, "test.pid");

    const changesDir = join(testDir, "repo", "openspec/changes");
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

  test("daemon recovers working task without running agent", async () => {
    const { createDatabase } = await import("../db/connection.ts");
    const db = createDatabase(testDbPath);
    const { runMigrations } = await import("../db/migrations.ts");
    await runMigrations(db);

    const repoPath = join(testDir, "repo");
    await createTestRepo(db, "repo-recovery", repoPath);

    const changePath = join(repoPath, "openspec/changes/feature-recover");
    mkdirSync(changePath, { recursive: true });
    await createTestTask(db, "task-recover", "repo-recovery", changePath, "WORKING");

    const executionRepository = createExecutionRepository(db);
    await executionRepository.createExecution({
      id: "exec-recover",
      task_id: "task-recover",
      status: ExecutionStatus.RUNNING,
      started_at: new Date().toISOString(),
    });
    await executionRepository.createStepExecution({
      id: "step-recover",
      execution_id: "exec-recover",
      status: StepExecutionStatus.RUNNING,
      started_at: new Date().toISOString(),
      agent_pid: 999999999,
    });

    await db.destroy();

    let markReadyCalled = false;
    const mockSync: ServerSync = {
      ...createMockServerSync(),
      markTaskReady: async (_taskId: string) => {
        markReadyCalled = true;
        return {
          status: "WORKING" as const,
          execution: { id: "exec-new", workflowId: "workflow-new" },
          step: {
            id: "step-new",
            type: "implement",
            promptTemplate: "Recovery prompt",
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
    await Bun.sleep(100);

    expect(markReadyCalled).toBe(true);
  });

  test("daemon does not recover task with degraded server sync", async () => {
    const { createDatabase } = await import("../db/connection.ts");
    const db = createDatabase(testDbPath);
    const { runMigrations } = await import("../db/migrations.ts");
    await runMigrations(db);

    const repoPath = join(testDir, "repo");
    await createTestRepo(db, "repo-degraded", repoPath);

    const changePath = join(repoPath, "openspec/changes/feature-degraded");
    mkdirSync(changePath, { recursive: true });
    await createTestTask(db, "task-degraded", "repo-degraded", changePath, "WORKING");

    await db.destroy();

    let markReadyCalled = false;
    const mockSync: ServerSync = {
      ...createMockServerSync(),
      isDegraded: () => true,
      markTaskReady: async () => {
        markReadyCalled = true;
        return { status: "READY" as const, queued: true, message: "Degraded" };
      },
    };

    daemon = createDaemon({
      dbPath: testDbPath,
      pidFile: testPidFile,
      serverSync: mockSync,
    });

    await daemon.start();
    await Bun.sleep(100);

    expect(markReadyCalled).toBe(false);
  });

  test("daemon handles recovery failure gracefully", async () => {
    const { createDatabase } = await import("../db/connection.ts");
    const db = createDatabase(testDbPath);
    const { runMigrations } = await import("../db/migrations.ts");
    await runMigrations(db);

    const repoPath = join(testDir, "repo");
    await createTestRepo(db, "repo-fail", repoPath);

    const changePath = join(repoPath, "openspec/changes/feature-fail");
    mkdirSync(changePath, { recursive: true });
    await createTestTask(db, "task-fail", "repo-fail", changePath, "WORKING");

    await db.destroy();

    const mockSync: ServerSync = {
      ...createMockServerSync(),
      markTaskReady: async () => {
        throw new Error("Recovery failed");
      },
    };

    daemon = createDaemon({
      dbPath: testDbPath,
      pidFile: testPidFile,
      serverSync: mockSync,
    });

    await daemon.start();
    expect(daemon.isRunning()).toBe(true);
  });

  test("daemon handles recovery when server returns no step", async () => {
    const { createDatabase } = await import("../db/connection.ts");
    const db = createDatabase(testDbPath);
    const { runMigrations } = await import("../db/migrations.ts");
    await runMigrations(db);

    const repoPath = join(testDir, "repo");
    await createTestRepo(db, "repo-nostep", repoPath);

    const changePath = join(repoPath, "openspec/changes/feature-nostep");
    mkdirSync(changePath, { recursive: true });
    await createTestTask(db, "task-nostep", "repo-nostep", changePath, "WORKING");

    await db.destroy();

    const mockSync: ServerSync = {
      ...createMockServerSync(),
      markTaskReady: async () => ({
        status: "READY" as const,
        queued: true,
        message: "Queued but no step",
      }),
    };

    daemon = createDaemon({
      dbPath: testDbPath,
      pidFile: testPidFile,
      serverSync: mockSync,
    });

    await daemon.start();
    expect(daemon.isRunning()).toBe(true);
  });
});
