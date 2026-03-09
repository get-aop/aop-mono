import { describe, expect, test } from "bun:test";
import { generateTypeId, getTypeIdPrefix, isValidTypeId } from "./typeid";

describe("generateTypeId", () => {
  test("generates a valid typeid with the given prefix", () => {
    const id = generateTypeId("task");
    expect(id).toMatch(/^task_[0-9a-z]{26}$/);
  });

  test("generates unique IDs", () => {
    const id1 = generateTypeId("exec");
    const id2 = generateTypeId("exec");
    expect(id1).not.toBe(id2);
  });

  test("supports different prefixes", () => {
    const taskId = generateTypeId("task");
    const execId = generateTypeId("exec");
    const repoId = generateTypeId("repo");

    expect(taskId.startsWith("task_")).toBe(true);
    expect(execId.startsWith("exec_")).toBe(true);
    expect(repoId.startsWith("repo_")).toBe(true);
  });
});

describe("getTypeIdPrefix", () => {
  test("extracts prefix from valid typeid", () => {
    const id = generateTypeId("task");
    expect(getTypeIdPrefix(id)).toBe("task");
  });

  test("returns null for invalid typeid", () => {
    expect(getTypeIdPrefix("invalid")).toBe(null);
    expect(getTypeIdPrefix("")).toBe(null);
  });
});

describe("isValidTypeId", () => {
  test("validates correctly formatted typeid", () => {
    const id = generateTypeId("task");
    expect(isValidTypeId(id)).toBe(true);
  });

  test("validates with expected prefix", () => {
    const id = generateTypeId("task");
    expect(isValidTypeId(id, "task")).toBe(true);
    expect(isValidTypeId(id, "exec")).toBe(false);
  });

  test("returns false for invalid typeid", () => {
    expect(isValidTypeId("invalid")).toBe(false);
    expect(isValidTypeId("")).toBe(false);
  });
});
