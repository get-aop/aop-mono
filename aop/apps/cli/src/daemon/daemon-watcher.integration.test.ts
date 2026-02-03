import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestRepo } from "../db/test-utils.ts";
import { createRepoRepository } from "../repos/repository.ts";
import { createTaskRepository } from "../tasks/repository.ts";
import { createDaemon, notifyDaemon } from "./daemon.ts";

describe("Daemon Watcher Integration", () => {
  let testDir: string;
  let testDbPath: string;
  let testPidFile: string;
  let daemon: ReturnType<typeof createDaemon> | null = null;

  beforeEach(async () => {
    testDir = join(tmpdir(), `daemon-watcher-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
    testDbPath = join(testDir, "test.db");
    testPidFile = join(testDir, "test.pid");
  });

  afterEach(async () => {
    if (daemon?.isRunning()) {
      await daemon.stop();
    }
    daemon = null;
    await Bun.sleep(200);
    rmSync(testDir, { recursive: true, force: true });
  });

  test("watcher detects new change and creates task on refresh", async () => {
    const repoDir = join(testDir, "watched-repo");
    const changesDir = join(repoDir, "openspec/changes");
    mkdirSync(changesDir, { recursive: true });

    const { createDatabase } = await import("../db/connection.ts");
    const db = createDatabase(testDbPath);
    const { runMigrations } = await import("../db/migrations.ts");
    await runMigrations(db);

    await createTestRepo(db, "watched-repo", repoDir);
    await db.destroy();

    daemon = createDaemon({ dbPath: testDbPath, pidFile: testPidFile });
    await daemon.start();

    const changePath = join(changesDir, "new-change");
    mkdirSync(changePath, { recursive: true });
    writeFileSync(join(changePath, "proposal.md"), "# New Change");

    notifyDaemon(testPidFile);
    await Bun.sleep(300);

    const db2 = createDatabase(testDbPath);
    const taskRepository = createTaskRepository(db2);
    const tasks = await taskRepository.list({ repo_id: "watched-repo" });
    await db2.destroy();

    expect(tasks.length).toBeGreaterThanOrEqual(1);
  });

  test("watcher event callback triggers reconciliation on file change", async () => {
    const repoDir = join(testDir, "watcher-event-repo");
    const changesDir = join(repoDir, "openspec/changes");
    mkdirSync(changesDir, { recursive: true });

    const { createDatabase } = await import("../db/connection.ts");
    const db = createDatabase(testDbPath);
    const { runMigrations } = await import("../db/migrations.ts");
    await runMigrations(db);

    await createTestRepo(db, "watcher-event-repo", repoDir);
    await db.destroy();

    daemon = createDaemon({ dbPath: testDbPath, pidFile: testPidFile });
    await daemon.start();

    await Bun.sleep(100);

    const changePath = join(changesDir, "watcher-triggered-change");
    mkdirSync(changePath, { recursive: true });
    writeFileSync(join(changePath, "proposal.md"), "# Watcher Triggered");

    await Bun.sleep(1000);

    writeFileSync(join(changePath, "proposal.md"), "# Updated Content");

    await Bun.sleep(1000);

    const db2 = createDatabase(testDbPath);
    const taskRepository = createTaskRepository(db2);
    const tasks = await taskRepository.list({ repo_id: "watcher-event-repo" });
    await db2.destroy();

    expect(tasks.length).toBeGreaterThanOrEqual(1);
    expect(tasks[0]?.change_path).toContain("watcher-triggered-change");
  });

  test("ticker triggers periodic refresh", async () => {
    const repoDir = join(testDir, "ticker-repo");
    const changesDir = join(repoDir, "openspec/changes");
    mkdirSync(changesDir, { recursive: true });

    const { createDatabase } = await import("../db/connection.ts");
    const db = createDatabase(testDbPath);
    const { runMigrations } = await import("../db/migrations.ts");
    await runMigrations(db);

    await createTestRepo(db, "ticker-repo", repoDir);

    const { createSettingsRepository } = await import("../settings/repository.ts");
    const { SettingKey } = await import("../settings/types.ts");
    const settingsRepository = createSettingsRepository(db);
    await settingsRepository.set(SettingKey.WATCHER_POLL_INTERVAL_SECS, "1");

    await db.destroy();

    daemon = createDaemon({ dbPath: testDbPath, pidFile: testPidFile });
    await daemon.start();

    const changePath = join(changesDir, "ticker-detected-change");
    mkdirSync(changePath, { recursive: true });
    writeFileSync(join(changePath, "proposal.md"), "# Ticker Change");

    await Bun.sleep(1500);

    const db2 = createDatabase(testDbPath);
    const taskRepository = createTaskRepository(db2);
    const tasks = await taskRepository.list({ repo_id: "ticker-repo" });
    await db2.destroy();

    expect(tasks.length).toBeGreaterThanOrEqual(1);
  });

  test("refresh removes repo when path no longer exists", async () => {
    const repoDir = join(testDir, "temp-repo");
    const changesDir = join(repoDir, "openspec/changes");
    mkdirSync(changesDir, { recursive: true });

    const { createDatabase } = await import("../db/connection.ts");
    const db = createDatabase(testDbPath);
    const { runMigrations } = await import("../db/migrations.ts");
    await runMigrations(db);

    await createTestRepo(db, "temp-repo", repoDir);
    await db.destroy();

    daemon = createDaemon({ dbPath: testDbPath, pidFile: testPidFile });
    await daemon.start();

    rmSync(repoDir, { recursive: true, force: true });

    notifyDaemon(testPidFile);
    await Bun.sleep(200);

    const db2 = createDatabase(testDbPath);
    const repoRepository = createRepoRepository(db2);
    const repo = await repoRepository.getById("temp-repo");
    await db2.destroy();

    expect(repo).toBe(null);
  });
});
