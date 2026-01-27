import { describe, expect, test } from "bun:test";
import { getConflictSolverPrompt } from "./conflict-solver";

describe("getConflictSolverPrompt", () => {
  test("returns prompt with taskFolder and subtaskFile substituted", async () => {
    const taskFolder = "20260125143022-add-user-auth";
    const subtaskFile = "001-create-user-model.md";
    const prompt = await getConflictSolverPrompt(taskFolder, subtaskFile);

    expect(prompt).toContain(taskFolder);
    expect(prompt).toContain(subtaskFile);
  });

  test("includes instruction to identify conflicting files", async () => {
    const prompt = await getConflictSolverPrompt("my-task", "001-subtask.md");

    expect(prompt).toContain("conflicting files");
    expect(prompt).toContain("<<<<<<<");
  });

  test("includes instruction to resolve conflicts", async () => {
    const prompt = await getConflictSolverPrompt("my-task", "001-subtask.md");

    expect(prompt).toContain("Resolve");
  });

  test("includes instruction to complete merge commit", async () => {
    const prompt = await getConflictSolverPrompt("my-task", "001-subtask.md");

    expect(prompt).toContain("merge");
    expect(prompt).toContain("git commit");
  });

  test("includes instruction to abort on complex conflicts", async () => {
    const prompt = await getConflictSolverPrompt("my-task", "001-subtask.md");

    expect(prompt).toContain("Abort");
    expect(prompt).toContain("non-zero");
  });

  test("warns against guessing on logic conflicts", async () => {
    const prompt = await getConflictSolverPrompt("my-task", "001-subtask.md");

    expect(prompt).toContain("Do not guess");
    expect(prompt).toContain("logic conflicts");
  });
});
