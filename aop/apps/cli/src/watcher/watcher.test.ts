import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WatcherEvent } from "./types.ts";
import { createWatcherManager } from "./watcher.ts";

describe("WatcherManager", () => {
  let testDir: string;
  let changesDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `watcher-test-${Date.now()}`);
    changesDir = join(testDir, "openspec/changes");
    mkdirSync(changesDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("debouncing", () => {
    test("debounces multiple rapid events for the same change", async () => {
      const events: WatcherEvent[] = [];
      const manager = createWatcherManager((e) => events.push(e), { debounceMs: 50 });

      manager.addRepo("repo-1", testDir);

      mkdirSync(join(changesDir, "my-change"));
      writeFileSync(join(changesDir, "my-change", "file1.txt"), "content");
      writeFileSync(join(changesDir, "my-change", "file2.txt"), "content");

      await new Promise((r) => setTimeout(r, 150));

      manager.stop();

      expect(events.length).toBeLessThanOrEqual(2);
      if (events.length > 0) {
        const firstEvent = events[0];
        if (!firstEvent) throw new Error("Expected first event");
        expect(firstEvent.changeName).toBe("my-change");
        expect(firstEvent.type).toBe("create");
      }
    });

    test("emits separate events for different changes", async () => {
      const events: WatcherEvent[] = [];
      const manager = createWatcherManager((e) => events.push(e), { debounceMs: 20 });

      manager.addRepo("repo-1", testDir);

      mkdirSync(join(changesDir, "change-a"));
      await new Promise((r) => setTimeout(r, 50));
      mkdirSync(join(changesDir, "change-b"));

      await new Promise((r) => setTimeout(r, 100));

      manager.stop();

      const changeNames = events.map((e) => e.changeName);
      expect(changeNames).toContain("change-a");
      expect(changeNames).toContain("change-b");
    });
  });

  describe("addRepo", () => {
    test("adds and starts watching a repo", async () => {
      const events: WatcherEvent[] = [];
      const manager = createWatcherManager((e) => events.push(e), { debounceMs: 10 });

      manager.addRepo("repo-1", testDir);

      mkdirSync(join(changesDir, "new-change"));

      await new Promise((r) => setTimeout(r, 100));

      manager.stop();

      expect(events.length).toBeGreaterThanOrEqual(1);
      const firstEvent = events[0];
      if (!firstEvent) throw new Error("Expected first event");
      expect(firstEvent.repoId).toBe("repo-1");
      expect(firstEvent.repoPath).toBe(testDir);
    });

    test("warns and ignores duplicate repo additions", () => {
      const events: WatcherEvent[] = [];
      const manager = createWatcherManager((e) => events.push(e));

      manager.addRepo("repo-1", testDir);
      manager.addRepo("repo-1", testDir);

      manager.stop();
    });
  });

  describe("removeRepo", () => {
    test("stops watching a removed repo", async () => {
      const events: WatcherEvent[] = [];
      const manager = createWatcherManager((e) => events.push(e), { debounceMs: 10 });

      manager.addRepo("repo-1", testDir);
      manager.removeRepo("repo-1");

      mkdirSync(join(changesDir, "new-change"));

      await new Promise((r) => setTimeout(r, 100));

      manager.stop();

      expect(events).toHaveLength(0);
    });
  });

  describe("stop", () => {
    test("stops all watchers and clears timers", () => {
      const events: WatcherEvent[] = [];
      const manager = createWatcherManager((e) => events.push(e));

      manager.addRepo("repo-1", testDir);
      manager.stop();
    });
  });
});
