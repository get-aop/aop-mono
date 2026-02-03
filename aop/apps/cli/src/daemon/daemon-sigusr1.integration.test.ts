import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRepoRepository } from "../repos/repository.ts";
import { createTaskRepository } from "../tasks/repository.ts";
import { TaskStatus } from "../tasks/types.ts";
import { createDaemon, notifyDaemon } from "./daemon.ts";

describe("Daemon SIGUSR1 Refresh Integration", () => {
  let testDir: string;
  let testDbPath: string;
  let testPidFile: string;
  let daemon: ReturnType<typeof createDaemon> | null = null;

  beforeEach(async () => {
    testDir = join(
      tmpdir(),
      `daemon-sigusr1-integration-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(testDir, { recursive: true });
    testDbPath = join(testDir, "test.db");
    testPidFile = join(testDir, "test.pid");
  });

  afterEach(async () => {
    if (daemon?.isRunning()) {
      await daemon.stop();
    }
    daemon = null;
    await Bun.sleep(300);
    rmSync(testDir, { recursive: true, force: true });
  });

  test("daemon handles SIGUSR1 without crashing", async () => {
    daemon = createDaemon({ dbPath: testDbPath, pidFile: testPidFile });

    await daemon.start();
    expect(daemon.isRunning()).toBe(true);

    const notified = notifyDaemon(testPidFile);
    expect(notified).toBe(true);

    await Bun.sleep(100);

    expect(daemon.isRunning()).toBe(true);
  });

  test("daemon picks up new repo after SIGUSR1", async () => {
    daemon = createDaemon({ dbPath: testDbPath, pidFile: testPidFile });

    await daemon.start();

    const repoDir = join(testDir, "new-repo");
    const changesDir = join(repoDir, "openspec/changes");
    mkdirSync(changesDir, { recursive: true });

    const { createDatabase } = await import("../db/connection.ts");
    const db = createDatabase(testDbPath);
    const repoRepository = createRepoRepository(db);

    await repoRepository.create({
      id: "repo-new",
      path: repoDir,
      name: "new-repo",
      remote_origin: null,
      max_concurrent_tasks: 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const changePath = join(changesDir, "test-change");
    mkdirSync(changePath, { recursive: true });
    writeFileSync(join(changePath, "proposal.md"), "# Test Change");

    notifyDaemon(testPidFile);

    await Bun.sleep(200);

    const taskRepository = createTaskRepository(db);
    const tasks = await taskRepository.list({ repo_id: "repo-new" });

    expect(tasks.length).toBe(1);
    expect(tasks[0]?.change_path).toBe("openspec/changes/test-change");
    expect(tasks[0]?.status).toBe(TaskStatus.DRAFT);

    await db.destroy();
  });
});
