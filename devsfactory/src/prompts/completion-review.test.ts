import { describe, expect, test } from "bun:test";
import { getCompletionReviewPrompt } from "./completion-review";

describe("getCompletionReviewPrompt", () => {
  test("returns prompt with taskFolder and devsfactoryDir substituted", async () => {
    const taskFolder = "20260125143022-add-user-auth";
    const devsfactoryDir = ".devsfactory";
    const prompt = await getCompletionReviewPrompt(taskFolder, devsfactoryDir);

    expect(prompt).toContain(taskFolder);
    expect(prompt).toContain(devsfactoryDir);
  });

  test("includes task.md, plan.md and review.md file references", async () => {
    const prompt = await getCompletionReviewPrompt("my-task", ".devsfactory");

    expect(prompt).toContain("task.md");
    expect(prompt).toContain("plan.md");
    expect(prompt).toContain("review.md");
  });

  test("includes code-review skill instruction", async () => {
    const prompt = await getCompletionReviewPrompt("my-task", ".devsfactory");

    expect(prompt).toContain("code-review");
  });

  test("includes review attempts instructions", async () => {
    const prompt = await getCompletionReviewPrompt("my-task", ".devsfactory");

    expect(prompt).toContain("remaining attempts");
    expect(prompt).toContain("1, 2, or 3");
  });

  test("includes PR creation instructions on approval", async () => {
    const prompt = await getCompletionReviewPrompt("my-task", ".devsfactory");

    expect(prompt).toContain("PR");
    expect(prompt).toContain("REVIEW");
  });

  test("includes blocked state instructions when no attempts remain", async () => {
    const prompt = await getCompletionReviewPrompt("my-task", ".devsfactory");

    expect(prompt).toContain("BLOCKED");
    expect(prompt).toContain("Blockers");
  });
});
