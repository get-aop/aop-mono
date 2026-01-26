import { describe, expect, test } from "bun:test";
import { getImplementationPrompt } from "./implementation";

describe("getImplementationPrompt", () => {
  test("returns prompt with subtask title and path substituted", async () => {
    const subtaskTitle = "Create user model";
    const subtaskPath =
      "/home/user/.devsfactory/20260125143022-add-user-auth/001-create-user-model.md";
    const prompt = await getImplementationPrompt(subtaskTitle, subtaskPath);

    expect(prompt).toContain(subtaskTitle);
    expect(prompt).toContain(subtaskPath);
  });

  test("includes test-driven-development requirement", async () => {
    const prompt = await getImplementationPrompt(
      "Test subtask",
      "/path/to/subtask.md"
    );

    expect(prompt).toContain("test-driven-development");
    expect(prompt).toContain("REQUIRED SUB-SKILL");
  });

  test("includes code-simplifier instruction", async () => {
    const prompt = await getImplementationPrompt(
      "Test subtask",
      "/path/to/subtask.md"
    );

    expect(prompt).toContain("code-simplifier");
  });

  test("includes instructions for completion", async () => {
    const prompt = await getImplementationPrompt(
      "Test subtask",
      "/path/to/subtask.md"
    );

    expect(prompt).toContain("AGENT_REVIEW");
    expect(prompt).toContain("Result");
    expect(prompt).toContain("commit");
  });

  test("includes instructions for blocked state", async () => {
    const prompt = await getImplementationPrompt(
      "Test subtask",
      "/path/to/subtask.md"
    );

    expect(prompt).toContain("BLOCKED");
    expect(prompt).toContain("blocker");
  });
});
