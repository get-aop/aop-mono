import { describe, expect, test } from "bun:test";
import { getImplementationPrompt } from "./implementation";

describe("getImplementationPrompt", () => {
  test("returns prompt with subtask path and task dir substituted", async () => {
    const subtaskPath =
      "/home/user/.devsfactory/20260125143022-add-user-auth/001-create-user-model.md";
    const prompt = await getImplementationPrompt(subtaskPath);

    expect(prompt).toContain(subtaskPath);
    expect(prompt).toContain(
      "/home/user/.devsfactory/20260125143022-add-user-auth"
    );
  });

  test("includes test-driven-development skill", async () => {
    const prompt = await getImplementationPrompt("/path/to/task/subtask.md");

    expect(prompt).toContain("test-driven-development");
  });

  test("includes success criteria", async () => {
    const prompt = await getImplementationPrompt("/path/to/task/subtask.md");

    expect(prompt).toContain("success_criteria");
    expect(prompt).toContain("AGENT_REVIEW");
  });

  test("includes decision boundaries", async () => {
    const prompt = await getImplementationPrompt("/path/to/task/subtask.md");

    expect(prompt).toContain("decision_boundaries");
    expect(prompt).toContain("BLOCKED");
  });
});
