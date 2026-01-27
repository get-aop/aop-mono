import { describe, expect, test } from "bun:test";
import { getTemplate, loadTemplate, renderTemplate } from "./index";

describe("loadTemplate", () => {
  test("loads planning template", async () => {
    const template = await loadTemplate("planning");
    expect(template).toContain("{{taskPath}}");
  });

  test("loads implementation template", async () => {
    const template = await loadTemplate("implementation");
    expect(template).toContain("{{subtaskPath}}");
    expect(template).toContain("{{taskDir}}");
  });

  test("loads review template", async () => {
    const template = await loadTemplate("review");
    expect(template).toContain("{{subtaskPath}}");
    expect(template).toContain("{{reviewPath}}");
  });

  test("caches templates after first load", async () => {
    const first = await loadTemplate("planning");
    const second = await loadTemplate("planning");
    expect(first).toBe(second);
  });
});

describe("renderTemplate", () => {
  test("substitutes single variable", () => {
    const template = "Hello {{name}}!";
    const result = renderTemplate(template, { name: "World" });
    expect(result).toBe("Hello World!");
  });

  test("substitutes multiple variables", () => {
    const template = "{{greeting}} {{name}}!";
    const result = renderTemplate(template, { greeting: "Hi", name: "Alice" });
    expect(result).toBe("Hi Alice!");
  });

  test("substitutes same variable multiple times", () => {
    const template = "{{x}} + {{x}} = 2{{x}}";
    const result = renderTemplate(template, { x: "1" });
    expect(result).toBe("1 + 1 = 21");
  });

  test("leaves unmatched placeholders unchanged", () => {
    const template = "{{known}} and {{unknown}}";
    const result = renderTemplate(template, { known: "value" });
    expect(result).toBe("value and {{unknown}}");
  });
});

describe("getTemplate", () => {
  test("loads and renders template in one call", async () => {
    const result = await getTemplate("planning", {
      taskPath: "/path/to/task.md"
    });
    expect(result).toContain("/path/to/task.md");
    expect(result).not.toContain("{{taskPath}}");
  });
});
