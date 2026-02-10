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
      "codebase-research.md.hbs",
      "plan-implementation.md.hbs",
      "implement-backend.md.hbs",
      "implement-frontend.md.hbs",
      "visual-verify.md.hbs",
      "run-tests.md.hbs",
      "seo-audit.md.hbs",
      "code-review-step.md.hbs",
      "debug-systematic.md.hbs",
      "address-feedback.md.hbs",
      "plan-research.md.hbs",
      "research.md.hbs",
    ];

    for (const filename of templateFiles) {
      test(`loads ${filename} template with resolved partials`, async () => {
        const template = await loader.load(filename);

        expect(template).toContain("{{worktree.path}}");
        expect(template).toContain("{{worktree.branch}}");
        expect(template).toContain("{{task.changePath}}");
        expect(template).not.toContain("{{> task-context}}");
        expect(template).not.toContain("{{> output-signals}}");
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

  describe("partial resolution", () => {
    test("expands task-context partial with all standard fields", async () => {
      const template = await loader.load("implement-backend.md.hbs");

      expect(template).toContain("{{task.changePath}}");
      expect(template).toContain("{{worktree.path}}");
      expect(template).toContain("{{worktree.branch}}");
      expect(template).toContain("{{#if input}}");
    });

    test("expands output-signals partial with signal template", async () => {
      const template = await loader.load("implement-backend.md.hbs");

      expect(template).toContain("{{#if signals}}");
      expect(template).toContain("{{#each signals}}");
      expect(template).toContain("{{this.name}}");
      expect(template).toContain("{{this.description}}");
      expect(template).not.toContain("{{> output-signals}}");
    });

    test("partial content is consistent across all templates", async () => {
      const backend = await loader.load("implement-backend.md.hbs");
      const frontend = await loader.load("implement-frontend.md.hbs");

      const extractContext = (t: string) => {
        const start = t.indexOf("## Task Details");
        const end = t.indexOf("{{/if}}") + "{{/if}}".length;
        return t.slice(start, end);
      };

      expect(extractContext(backend)).toBe(extractContext(frontend));
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
