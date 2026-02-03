import { beforeEach, describe, expect, test } from "bun:test";
import type { StepType } from "../workflow/types.ts";
import { createTemplateLoader, type TemplateLoader } from "./template-loader.ts";

describe("TemplateLoader", () => {
  let loader: TemplateLoader;

  beforeEach(() => {
    loader = createTemplateLoader();
  });

  describe("load", () => {
    const stepTypes: StepType[] = ["implement", "test", "review", "debug", "iterate"];

    for (const stepType of stepTypes) {
      test(`loads ${stepType} template`, async () => {
        const template = await loader.load(stepType);

        expect(template).toContain("{{worktree.path}}");
        expect(template).toContain("{{worktree.branch}}");
        expect(template).toContain("{{task.id}}");
        expect(template).toContain("{{task.changePath}}");
        expect(template).toContain("{{step.type}}");
        expect(template).toContain("{{step.executionId}}");
      });
    }

    test("caches loaded templates", async () => {
      const template1 = await loader.load("implement");
      const template2 = await loader.load("implement");

      expect(template1).toBe(template2);
    });

    test("throws for unknown step type", async () => {
      await expect(loader.load("unknown" as StepType)).rejects.toThrow(
        "Unknown step type: unknown",
      );
    });
  });

  describe("clearCache", () => {
    test("clears the template cache", async () => {
      await loader.load("implement");
      loader.clearCache();

      const template = await loader.load("implement");

      expect(template).toContain("{{worktree.path}}");
    });
  });
});
