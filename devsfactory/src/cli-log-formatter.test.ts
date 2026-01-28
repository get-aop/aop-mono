import { describe, expect, test } from "bun:test";
import {
  formatJobCompletedMessage,
  formatSubtaskCompletedMessage,
  formatSubtaskStartMessage
} from "./cli-log-formatter";

describe("formatJobCompletedMessage", () => {
  test("formats job completion with duration", () => {
    const result = formatJobCompletedMessage("implementation", 272000);
    expect(result).toBe("✓ implementation completed (4m 32s)");
  });

  test("formats short duration", () => {
    const result = formatJobCompletedMessage("merge", 6000);
    expect(result).toBe("✓ merge completed (6s)");
  });

  test("formats duration under 1 second", () => {
    const result = formatJobCompletedMessage("review", 500);
    expect(result).toBe("✓ review completed (< 1s)");
  });
});

describe("formatSubtaskStartMessage", () => {
  test("formats subtask start with number and title", () => {
    const result = formatSubtaskStartMessage(1, 7, "Create dashboard layout");
    expect(result).toBe("▶ Starting subtask 1/7: Create dashboard layout");
  });

  test("formats with different numbers", () => {
    const result = formatSubtaskStartMessage(3, 10, "Add authentication");
    expect(result).toBe("▶ Starting subtask 3/10: Add authentication");
  });
});

describe("formatSubtaskCompletedMessage", () => {
  test("formats subtask completion with duration", () => {
    const result = formatSubtaskCompletedMessage(
      1,
      7,
      "Create dashboard layout",
      363000
    );
    expect(result).toBe(
      "✓ Subtask 1/7: Create dashboard layout completed (6m 3s)"
    );
  });

  test("formats with hour-long duration", () => {
    const result = formatSubtaskCompletedMessage(
      2,
      5,
      "Implement API",
      5520000
    );
    expect(result).toBe("✓ Subtask 2/5: Implement API completed (1h 32m)");
  });
});
