import { afterEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { MarkdownViewer } from "./MarkdownViewer";

if (!globalThis.document || !("defaultView" in globalThis.document)) {
  const win = new Window({ url: "http://localhost" });
  for (const key of Object.getOwnPropertyNames(win)) {
    if (!(key in globalThis)) {
      Object.defineProperty(globalThis, key, {
        value: (win as unknown as Record<string, unknown>)[key],
        configurable: true,
        writable: true,
      });
    }
  }
  globalThis.document = win.document as unknown as Document;
}

const { render, screen, cleanup } = await import("@testing-library/react");

afterEach(cleanup);

const richMarkdown = [
  "# Heading 1",
  "## Heading 2",
  "### Heading 3",
  "",
  "A paragraph with **bold text** and `inline code`.",
  "",
  "[a link](https://example.com)",
  "",
  "> a blockquote",
  "",
  "```ts",
  "const x = 1;",
  "```",
  "",
  "| Col A | Col B |",
  "|-------|-------|",
  "| cell1 | cell2 |",
  "",
  "- unordered item",
  "",
  "1. ordered item",
  "",
  "- [x] checked",
  "- [ ] unchecked",
  "",
  "---",
].join("\n");

describe("MarkdownViewer", () => {
  test("renders all markdown element types", () => {
    const { container } = render(<MarkdownViewer content={richMarkdown} />);

    expect(screen.getByTestId("markdown-viewer")).toBeTruthy();

    const html = container.innerHTML;
    expect(html).toContain("<h1");
    expect(html).toContain("<h2");
    expect(html).toContain("<h3");
    expect(html).toContain("<p");
    expect(html).toContain("<a");
    expect(html).toContain("<blockquote");
    expect(html).toContain("<code");
    expect(html).toContain("<pre");
    expect(html).toContain("<table");
    expect(html).toContain("<th");
    expect(html).toContain("<td");
    expect(html).toContain("<ul");
    expect(html).toContain("<ol");
    expect(html).toContain("<li");
    expect(html).toContain("<strong");
    expect(html).toContain("<hr");
    expect(html).toContain("<input");
  });

  test("applies aop styling classes", () => {
    const { container } = render(<MarkdownViewer content={richMarkdown} />);
    const html = container.innerHTML;

    expect(html).toContain("text-aop-cream");
    expect(html).toContain("text-aop-amber");
    expect(html).toContain("border-aop-charcoal");
  });

  test("renders empty content without error", () => {
    render(<MarkdownViewer content="" />);
    expect(screen.getByTestId("markdown-viewer")).toBeTruthy();
  });
});
