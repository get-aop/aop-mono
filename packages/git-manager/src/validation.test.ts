import { describe, expect, test } from "bun:test";
import { validateTaskId } from "./validation.ts";

describe("validateTaskId", () => {
  describe("valid taskIds", () => {
    test("accepts simple alphanumeric", () => {
      expect(() => validateTaskId("feat-auth")).not.toThrow();
      expect(() => validateTaskId("fix123")).not.toThrow();
      expect(() => validateTaskId("a")).not.toThrow();
    });

    test("accepts underscores and hyphens", () => {
      expect(() => validateTaskId("feat_auth")).not.toThrow();
      expect(() => validateTaskId("fix-bug-123")).not.toThrow();
      expect(() => validateTaskId("task_123-test")).not.toThrow();
    });

    test("accepts forward slashes for namespaced tasks", () => {
      expect(() => validateTaskId("feat/auth")).not.toThrow();
      expect(() => validateTaskId("fix/bug/123")).not.toThrow();
    });
  });

  describe("invalid taskIds", () => {
    test("rejects empty string", () => {
      expect(() => validateTaskId("")).toThrow("cannot be empty");
    });

    test("rejects path traversal with ..", () => {
      expect(() => validateTaskId("../foo")).toThrow("path traversal");
      expect(() => validateTaskId("foo/../bar")).toThrow("path traversal");
      expect(() => validateTaskId("foo/..")).toThrow("path traversal");
      expect(() => validateTaskId("..")).toThrow("path traversal");
    });

    test("rejects consecutive slashes", () => {
      expect(() => validateTaskId("foo//bar")).toThrow("path traversal");
    });

    test("rejects leading/trailing special characters", () => {
      expect(() => validateTaskId("-foo")).toThrow("Invalid taskId");
      expect(() => validateTaskId("foo-")).toThrow("Invalid taskId");
      expect(() => validateTaskId("/foo")).toThrow("Invalid taskId");
      expect(() => validateTaskId("foo/")).toThrow("Invalid taskId");
      expect(() => validateTaskId("_foo")).toThrow("Invalid taskId");
    });

    test("rejects overly long taskIds", () => {
      const longId = "a".repeat(101);
      expect(() => validateTaskId(longId)).toThrow("exceeds maximum length");
    });

    test("rejects special characters", () => {
      expect(() => validateTaskId("foo bar")).toThrow("Invalid taskId");
      expect(() => validateTaskId("foo@bar")).toThrow("Invalid taskId");
      expect(() => validateTaskId("foo$bar")).toThrow("Invalid taskId");
    });
  });
});
