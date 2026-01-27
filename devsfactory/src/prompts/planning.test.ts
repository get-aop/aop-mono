import { describe, expect, test } from "bun:test";
import { getPlanningPrompt } from "./planning";

describe("getPlanningPrompt", () => {
  test("returns prompt with task path substituted", async () => {
    const taskPath =
      "/home/user/.devsfactory/20260125143022-add-user-auth/task.md";
    const prompt = await getPlanningPrompt(taskPath);

    expect(prompt).toContain(taskPath);
  });

  test("includes brainstorming instruction", async () => {
    const prompt = await getPlanningPrompt("/path/to/task.md");

    expect(prompt).toContain("brainstorm");
  });

  test("uses task-planner skill", async () => {
    const prompt = await getPlanningPrompt("/path/to/task.md");

    expect(prompt).toContain("task-planner");
  });

  test("mentions subtasks", async () => {
    const prompt = await getPlanningPrompt("/path/to/task.md");

    expect(prompt).toContain("subtasks");
  });
});
