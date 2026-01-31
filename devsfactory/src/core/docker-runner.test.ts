import { describe, expect, test } from "bun:test";
import { getProjectRoot } from "./docker-runner";

describe("docker-runner", () => {
  describe("getProjectRoot", () => {
    test("returns path to project root", () => {
      const root = getProjectRoot();
      expect(root).toContain("devsfactory");
      expect(root).not.toContain("src/core");
    });
  });
});
