import { describe, expect, test } from "bun:test";
import { parseStartTaskArgs } from "./start-task";

describe("parseStartTaskArgs", () => {
  test("returns help flag when -h is provided", () => {
    const result = parseStartTaskArgs(["-h"]);
    expect(result.help).toBe(true);
  });

  test("parses task folder positional argument", () => {
    const result = parseStartTaskArgs(["20260201123000-add-auth"]);
    expect(result.taskFolder).toBe("20260201123000-add-auth");
    expect(result.taskId).toBeUndefined();
  });

  test("parses project name with --project", () => {
    const result = parseStartTaskArgs([
      "20260201123000-add-auth",
      "--project",
      "my-project"
    ]);
    expect(result.projectName).toBe("my-project");
  });

  test("parses task id with --task-id", () => {
    const result = parseStartTaskArgs(["--task-id", "42"]);
    expect(result.taskId).toBe(42);
    expect(result.taskFolder).toBeUndefined();
  });

  test("returns error when both folder and task id are provided", () => {
    const result = parseStartTaskArgs([
      "20260201123000-add-auth",
      "--task-id",
      "42"
    ]);
    expect(result.error).toBe(
      "Provide either a task folder or --task-id, not both"
    );
  });

  test("returns error for invalid task id", () => {
    const result = parseStartTaskArgs(["--task-id", "not-a-number"]);
    expect(result.error).toBe("--task-id must be a positive integer");
  });

  test("returns error when --project is missing a value", () => {
    const result = parseStartTaskArgs(["--project"]);
    expect(result.error).toBe("--project requires a value");
  });
});
