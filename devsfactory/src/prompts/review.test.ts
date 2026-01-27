import { describe, expect, test } from "bun:test";
import { getReviewPrompt } from "./review";

describe("getReviewPrompt", () => {
  test("returns prompt with subtask path and review path substituted", async () => {
    const subtaskPath =
      "/home/user/.devsfactory/20260125143022-add-user-auth/001-create-user-model.md";
    const reviewPath =
      "/home/user/.devsfactory/20260125143022-add-user-auth/001-create-user-model-review.md";
    const prompt = await getReviewPrompt(subtaskPath, reviewPath);

    expect(prompt).toContain(subtaskPath);
    expect(prompt).toContain(reviewPath);
  });

  test("includes code-review skill instruction", async () => {
    const prompt = await getReviewPrompt(
      "/path/to/subtask.md",
      "/path/to/review.md"
    );

    expect(prompt).toContain("code-review");
  });

  test("includes review attempts instructions", async () => {
    const prompt = await getReviewPrompt(
      "/path/to/subtask.md",
      "/path/to/review.md"
    );

    expect(prompt).toContain("remaining attempts");
    expect(prompt).toContain("1, 2, or 3");
  });

  test("includes approval instructions with PENDING_MERGE status", async () => {
    const prompt = await getReviewPrompt(
      "/path/to/subtask.md",
      "/path/to/review.md"
    );

    expect(prompt).toContain("PENDING_MERGE");
  });

  test("includes blocked state instructions", async () => {
    const prompt = await getReviewPrompt(
      "/path/to/subtask.md",
      "/path/to/review.md"
    );

    expect(prompt).toContain("BLOCKED");
    expect(prompt).toContain("Blockers");
  });
});
