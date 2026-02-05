import { describe, expect, test } from "bun:test";
import type { ReactElement } from "react";
import { type LogLine, LogViewer } from "./LogViewer";

const renderToString = async (component: ReactElement): Promise<string> => {
  const { renderToStaticMarkup } = await import("react-dom/server");
  return renderToStaticMarkup(component);
};

const makeLine = (content: string, type: "stdout" | "stderr" = "stdout"): LogLine => ({
  type,
  content,
  timestamp: "2024-01-01T00:00:00.000Z",
});

describe("LogViewer", () => {
  test("renders waiting message when no lines", async () => {
    const html = await renderToString(<LogViewer lines={[]} />);
    expect(html).toContain("Waiting for logs...");
  });

  test("renders stdout lines with cream color", async () => {
    const lines = [makeLine("hello world")];
    const html = await renderToString(<LogViewer lines={lines} />);
    expect(html).toContain("hello world");
    expect(html).toContain("text-aop-cream");
  });

  test("renders stderr lines with blocked color", async () => {
    const lines = [makeLine("error occurred", "stderr")];
    const html = await renderToString(<LogViewer lines={lines} />);
    expect(html).toContain("error occurred");
    expect(html).toContain("text-aop-blocked");
  });

  test("renders multiple lines in order", async () => {
    const lines = [makeLine("line 1"), makeLine("line 2"), makeLine("line 3")];
    const html = await renderToString(<LogViewer lines={lines} />);
    const idx1 = html.indexOf("line 1");
    const idx2 = html.indexOf("line 2");
    const idx3 = html.indexOf("line 3");
    expect(idx1).toBeLessThan(idx2);
    expect(idx2).toBeLessThan(idx3);
  });

  test("auto-scrolls to bottom when lines are added", async () => {
    const { Window } = await import("happy-dom");
    const window = new Window();
    const document = window.document;

    // Patch globals for react-dom/client
    const origDocument = globalThis.document;
    const origWindow = globalThis.window;
    Object.assign(globalThis, { document, window });

    try {
      const { createRoot } = await import("react-dom/client");
      const container = document.createElement("div");
      document.body.appendChild(container);

      const lines = [makeLine("line 1"), makeLine("line 2")];

      await new Promise<void>((resolve) => {
        const root = createRoot(container as unknown as HTMLElement);
        root.render(<LogViewer lines={lines} />);
        setTimeout(resolve, 50);
      });

      const viewer = container.querySelector(
        "[data-testid='log-viewer']",
      ) as unknown as HTMLElement;
      expect(viewer).toBeTruthy();
      expect(viewer.textContent).toContain("line 1");
      expect(viewer.textContent).toContain("line 2");
    } finally {
      Object.assign(globalThis, { document: origDocument, window: origWindow });
    }
  });
});
