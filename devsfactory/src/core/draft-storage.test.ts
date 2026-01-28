import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { BrainstormDraft } from "../types";
import {
  cleanupOldDrafts,
  deleteDraft,
  listDrafts,
  loadDraft,
  saveDraft
} from "./draft-storage";

const TEST_DIR = "/tmp/draft-storage-test";
const DEVSFACTORY_DIR = join(TEST_DIR, ".devsfactory");
const DRAFTS_DIR = join(DEVSFACTORY_DIR, ".drafts");

const createMockDraft = (
  overrides: Partial<BrainstormDraft> = {}
): BrainstormDraft => ({
  sessionId: "test-session-123",
  messages: [
    {
      id: "msg-1",
      role: "user",
      content: "Hello",
      timestamp: new Date("2026-01-28T10:00:00Z")
    },
    {
      id: "msg-2",
      role: "assistant",
      content: "Hi there!",
      timestamp: new Date("2026-01-28T10:00:01Z")
    }
  ],
  partialTaskData: {
    title: "Test Task",
    description: "A test description"
  },
  status: "brainstorming",
  createdAt: new Date("2026-01-28T10:00:00Z"),
  updatedAt: new Date("2026-01-28T10:00:01Z"),
  ...overrides
});

describe("draft-storage", () => {
  beforeEach(async () => {
    await mkdir(DRAFTS_DIR, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  describe("saveDraft", () => {
    test("saves a draft to the filesystem", async () => {
      const draft = createMockDraft();
      await saveDraft(draft, DEVSFACTORY_DIR);

      const filePath = join(DRAFTS_DIR, `${draft.sessionId}.json`);
      const content = await readFile(filePath, "utf-8");
      const saved = JSON.parse(content);

      expect(saved.sessionId).toBe(draft.sessionId);
      expect(saved.status).toBe("brainstorming");
      expect(saved.messages).toHaveLength(2);
    });

    test("creates drafts directory if it does not exist", async () => {
      await rm(DRAFTS_DIR, { recursive: true, force: true });
      const draft = createMockDraft();

      await saveDraft(draft, DEVSFACTORY_DIR);

      const filePath = join(DRAFTS_DIR, `${draft.sessionId}.json`);
      const content = await readFile(filePath, "utf-8");
      expect(content).toBeTruthy();
    });

    test("overwrites existing draft with same sessionId", async () => {
      const draft1 = createMockDraft({ status: "brainstorming" });
      const draft2 = createMockDraft({ status: "planning" });

      await saveDraft(draft1, DEVSFACTORY_DIR);
      await saveDraft(draft2, DEVSFACTORY_DIR);

      const filePath = join(DRAFTS_DIR, `${draft1.sessionId}.json`);
      const content = await readFile(filePath, "utf-8");
      const saved = JSON.parse(content);

      expect(saved.status).toBe("planning");
    });

    test("saves draft with complete task preview data", async () => {
      const draft = createMockDraft({
        partialTaskData: {
          title: "Complete Task",
          description: "Full description",
          requirements: "All requirements",
          acceptanceCriteria: ["Criteria 1", "Criteria 2"]
        }
      });

      await saveDraft(draft, DEVSFACTORY_DIR);

      const filePath = join(DRAFTS_DIR, `${draft.sessionId}.json`);
      const content = await readFile(filePath, "utf-8");
      const saved = JSON.parse(content);

      expect(saved.partialTaskData.title).toBe("Complete Task");
      expect(saved.partialTaskData.acceptanceCriteria).toHaveLength(2);
    });
  });

  describe("loadDraft", () => {
    test("loads an existing draft", async () => {
      const draft = createMockDraft();
      await saveDraft(draft, DEVSFACTORY_DIR);

      const loaded = await loadDraft(draft.sessionId, DEVSFACTORY_DIR);

      expect(loaded).not.toBeNull();
      expect(loaded!.sessionId).toBe(draft.sessionId);
      expect(loaded!.status).toBe("brainstorming");
      expect(loaded!.messages).toHaveLength(2);
    });

    test("returns null for non-existent draft", async () => {
      const loaded = await loadDraft("non-existent-id", DEVSFACTORY_DIR);
      expect(loaded).toBeNull();
    });

    test("returns null and logs warning for invalid JSON", async () => {
      const filePath = join(DRAFTS_DIR, "invalid.json");
      await writeFile(filePath, "not valid json {{{");

      const loaded = await loadDraft("invalid", DEVSFACTORY_DIR);
      expect(loaded).toBeNull();
    });

    test("returns null and logs warning for schema validation failure", async () => {
      const filePath = join(DRAFTS_DIR, "bad-schema.json");
      await writeFile(
        filePath,
        JSON.stringify({
          sessionId: "bad-schema",
          messages: "not an array"
        })
      );

      const loaded = await loadDraft("bad-schema", DEVSFACTORY_DIR);
      expect(loaded).toBeNull();
    });

    test("correctly parses dates from JSON", async () => {
      const draft = createMockDraft({
        createdAt: new Date("2026-01-28T12:00:00Z"),
        updatedAt: new Date("2026-01-28T13:00:00Z")
      });
      await saveDraft(draft, DEVSFACTORY_DIR);

      const loaded = await loadDraft(draft.sessionId, DEVSFACTORY_DIR);

      expect(loaded!.createdAt).toEqual(new Date("2026-01-28T12:00:00Z"));
      expect(loaded!.updatedAt).toEqual(new Date("2026-01-28T13:00:00Z"));
    });
  });

  describe("listDrafts", () => {
    test("returns empty array when no drafts exist", async () => {
      const drafts = await listDrafts(DEVSFACTORY_DIR);
      expect(drafts).toEqual([]);
    });

    test("returns all drafts sorted by updatedAt descending", async () => {
      const draft1 = createMockDraft({
        sessionId: "session-1",
        updatedAt: new Date("2026-01-28T10:00:00Z")
      });
      const draft2 = createMockDraft({
        sessionId: "session-2",
        updatedAt: new Date("2026-01-28T12:00:00Z")
      });
      const draft3 = createMockDraft({
        sessionId: "session-3",
        updatedAt: new Date("2026-01-28T11:00:00Z")
      });

      await saveDraft(draft1, DEVSFACTORY_DIR);
      await saveDraft(draft2, DEVSFACTORY_DIR);
      await saveDraft(draft3, DEVSFACTORY_DIR);

      const drafts = await listDrafts(DEVSFACTORY_DIR);

      expect(drafts).toHaveLength(3);
      expect(drafts[0]!.sessionId).toBe("session-2");
      expect(drafts[1]!.sessionId).toBe("session-3");
      expect(drafts[2]!.sessionId).toBe("session-1");
    });

    test("skips invalid draft files", async () => {
      const validDraft = createMockDraft({ sessionId: "valid" });
      await saveDraft(validDraft, DEVSFACTORY_DIR);

      await writeFile(join(DRAFTS_DIR, "invalid.json"), "not json");

      const drafts = await listDrafts(DEVSFACTORY_DIR);

      expect(drafts).toHaveLength(1);
      expect(drafts[0]!.sessionId).toBe("valid");
    });

    test("returns empty array when drafts directory does not exist", async () => {
      await rm(DRAFTS_DIR, { recursive: true, force: true });

      const drafts = await listDrafts(DEVSFACTORY_DIR);
      expect(drafts).toEqual([]);
    });
  });

  describe("deleteDraft", () => {
    test("deletes an existing draft", async () => {
      const draft = createMockDraft();
      await saveDraft(draft, DEVSFACTORY_DIR);

      await deleteDraft(draft.sessionId, DEVSFACTORY_DIR);

      const loaded = await loadDraft(draft.sessionId, DEVSFACTORY_DIR);
      expect(loaded).toBeNull();
    });

    test("does not throw when deleting non-existent draft", async () => {
      await expect(
        deleteDraft("non-existent", DEVSFACTORY_DIR)
      ).resolves.toBeUndefined();
    });
  });

  describe("cleanupOldDrafts", () => {
    test("deletes drafts older than 7 days by default", async () => {
      const now = new Date();
      const eightDaysAgo = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000);
      const sixDaysAgo = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);

      const oldDraft = createMockDraft({
        sessionId: "old-draft",
        updatedAt: eightDaysAgo
      });
      const recentDraft = createMockDraft({
        sessionId: "recent-draft",
        updatedAt: sixDaysAgo
      });

      await saveDraft(oldDraft, DEVSFACTORY_DIR);
      await saveDraft(recentDraft, DEVSFACTORY_DIR);

      const deletedCount = await cleanupOldDrafts(DEVSFACTORY_DIR);

      expect(deletedCount).toBe(1);

      const remaining = await listDrafts(DEVSFACTORY_DIR);
      expect(remaining).toHaveLength(1);
      expect(remaining[0]!.sessionId).toBe("recent-draft");
    });

    test("accepts custom maxAgeDays parameter", async () => {
      const now = new Date();
      const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
      const oneDayAgo = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000);

      const oldDraft = createMockDraft({
        sessionId: "three-days-old",
        updatedAt: threeDaysAgo
      });
      const recentDraft = createMockDraft({
        sessionId: "one-day-old",
        updatedAt: oneDayAgo
      });

      await saveDraft(oldDraft, DEVSFACTORY_DIR);
      await saveDraft(recentDraft, DEVSFACTORY_DIR);

      const deletedCount = await cleanupOldDrafts(DEVSFACTORY_DIR, 2);

      expect(deletedCount).toBe(1);

      const remaining = await listDrafts(DEVSFACTORY_DIR);
      expect(remaining).toHaveLength(1);
      expect(remaining[0]!.sessionId).toBe("one-day-old");
    });

    test("returns 0 when no drafts are old enough", async () => {
      const draft = createMockDraft({ updatedAt: new Date() });
      await saveDraft(draft, DEVSFACTORY_DIR);

      const deletedCount = await cleanupOldDrafts(DEVSFACTORY_DIR);

      expect(deletedCount).toBe(0);
    });

    test("returns 0 when no drafts exist", async () => {
      const deletedCount = await cleanupOldDrafts(DEVSFACTORY_DIR);
      expect(deletedCount).toBe(0);
    });
  });
});
