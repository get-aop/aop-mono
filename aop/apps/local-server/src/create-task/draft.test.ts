import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BrainstormingResult } from "./brainstorm-parser.ts";
import { deleteDraft, loadDraft, saveDraft } from "./draft.ts";

describe("create-task/draft", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `draft-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  const sampleRequirements: BrainstormingResult = {
    title: "Add user authentication",
    description: "Implement OAuth2 authentication for the API",
    requirements: ["Support Google OAuth", "Support GitHub OAuth", "Store tokens securely"],
    acceptanceCriteria: ["Users can sign in with Google", "Users can sign in with GitHub"],
  };

  describe("saveDraft", () => {
    it("creates .drafts directory if it does not exist", async () => {
      const path = await saveDraft(testDir, "add-auth", sampleRequirements);
      expect(path).toContain(".drafts");
      expect(await Bun.file(path).exists()).toBe(true);
    });

    it("writes requirements to JSON file", async () => {
      const path = await saveDraft(testDir, "add-auth", sampleRequirements);
      const content = await Bun.file(path).json();

      expect(content.requirements).toEqual(sampleRequirements);
      expect(content.createdAt).toBeDefined();
      expect(content.path).toBe(path);
    });

    it("uses change name for filename", async () => {
      const path = await saveDraft(testDir, "my-feature", sampleRequirements);
      expect(path).toContain("my-feature.json");
    });

    it("overwrites existing draft with same name", async () => {
      await saveDraft(testDir, "add-auth", sampleRequirements);

      const updatedRequirements = { ...sampleRequirements, title: "Updated title" };
      const path = await saveDraft(testDir, "add-auth", updatedRequirements);

      const content = await Bun.file(path).json();
      expect(content.requirements.title).toBe("Updated title");
    });
  });

  describe("loadDraft", () => {
    it("returns null when draft does not exist", async () => {
      const result = await loadDraft(testDir, "nonexistent");
      expect(result).toBeNull();
    });

    it("loads existing draft", async () => {
      await saveDraft(testDir, "add-auth", sampleRequirements);
      const result = await loadDraft(testDir, "add-auth");

      expect(result).not.toBeNull();
      expect(result?.requirements).toEqual(sampleRequirements);
    });

    it("returns null for invalid JSON", async () => {
      const draftsDir = join(testDir, "openspec", "changes", ".drafts");
      await mkdir(draftsDir, { recursive: true });
      await Bun.write(join(draftsDir, "invalid.json"), "not valid json");

      const result = await loadDraft(testDir, "invalid");
      expect(result).toBeNull();
    });
  });

  describe("deleteDraft", () => {
    it("returns false when draft does not exist", async () => {
      const result = await deleteDraft(testDir, "nonexistent");
      expect(result).toBe(false);
    });

    it("deletes existing draft", async () => {
      const path = await saveDraft(testDir, "add-auth", sampleRequirements);
      expect(await Bun.file(path).exists()).toBe(true);

      const result = await deleteDraft(testDir, "add-auth");
      expect(result).toBe(true);
      expect(await Bun.file(path).exists()).toBe(false);
    });
  });
});
