import { beforeEach, describe, expect, test } from "bun:test";
import { createTemplateLoader, type TemplateLoader } from "./template-loader.ts";

describe("TemplateLoader", () => {
  let loader: TemplateLoader;

  beforeEach(() => {
    loader = createTemplateLoader();
  });

  describe("load", () => {
    const templateFiles = [
      "implement.md.hbs",
      "test.md.hbs",
      "review.md.hbs",
      "debug.md.hbs",
      "iterate.md.hbs",
      "full-review.md.hbs",
      "quick-review.md.hbs",
      "fix-issues.md.hbs",
    ];

    for (const filename of templateFiles) {
      test(`loads ${filename} template`, async () => {
        const template = await loader.load(filename);

        expect(template).toContain("{{worktree.path}}");
        expect(template).toContain("{{worktree.branch}}");
        expect(template).toContain("{{task.changePath}}");
        expect(template).toContain("{{step.type}}");
      });
    }

    test("caches loaded templates", async () => {
      const template1 = await loader.load("implement.md.hbs");
      const template2 = await loader.load("implement.md.hbs");

      expect(template1).toBe(template2);
    });

    test("throws for unknown template file", async () => {
      await expect(loader.load("unknown.md.hbs")).rejects.toThrow("Template not found");
    });
  });

  describe("clearCache", () => {
    test("clears the template cache", async () => {
      await loader.load("implement.md.hbs");
      loader.clearCache();

      const template = await loader.load("implement.md.hbs");

      expect(template).toContain("{{worktree.path}}");
    });
  });
});
