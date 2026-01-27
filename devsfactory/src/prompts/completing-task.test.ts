import { describe, expect, test } from "bun:test";
import { getCompletingTaskPrompt } from "./completing-task";

describe("getCompletingTaskPrompt", () => {
  test("returns prompt with taskFolder and devsfactoryDir substituted", async () => {
    const taskFolder = "20260125143022-add-user-auth";
    const devsfactoryDir = ".devsfactory";
    const prompt = await getCompletingTaskPrompt(taskFolder, devsfactoryDir);

    expect(prompt).toContain(taskFolder);
    expect(prompt).toContain(devsfactoryDir);
  });

  test("includes task.md and plan.md file references", async () => {
    const prompt = await getCompletingTaskPrompt("my-task", ".devsfactory");

    expect(prompt).toContain("task.md");
    expect(prompt).toContain("plan.md");
  });

  test("includes instructions for checking acceptance criteria", async () => {
    const prompt = await getCompletingTaskPrompt("my-task", ".devsfactory");

    expect(prompt).toContain("acceptance criteria");
  });

  test("includes AGENT_REVIEW status instruction when complete", async () => {
    const prompt = await getCompletingTaskPrompt("my-task", ".devsfactory");

    expect(prompt).toContain("AGENT_REVIEW");
  });

  test("includes instruction to create new subtasks if not complete", async () => {
    const prompt = await getCompletingTaskPrompt("my-task", ".devsfactory");

    expect(prompt).toContain("subtask");
    expect(prompt).toContain("plan");
  });
});
