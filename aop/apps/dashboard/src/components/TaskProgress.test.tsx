import { describe, expect, test } from "bun:test";
import type { ReactElement } from "react";
import { TaskProgress } from "./TaskProgress";

const renderToString = async (component: ReactElement): Promise<string> => {
  const { renderToStaticMarkup } = await import("react-dom/server");
  return renderToStaticMarkup(component);
};

describe("TaskProgress", () => {
  test("renders completed/total text", async () => {
    const html = await renderToString(<TaskProgress completed={3} total={17} />);
    expect(html).toContain("3/17");
  });

  test("renders progress bar with correct width", async () => {
    const html = await renderToString(<TaskProgress completed={1} total={4} />);
    expect(html).toContain("width:25%");
  });

  test("renders 0% when total is 0", async () => {
    const html = await renderToString(<TaskProgress completed={0} total={0} />);
    expect(html).toContain("0/0");
    expect(html).toContain("width:0%");
  });

  test("renders 100% when all complete", async () => {
    const html = await renderToString(<TaskProgress completed={5} total={5} />);
    expect(html).toContain("5/5");
    expect(html).toContain("width:100%");
  });

  test("has data-testid for querying", async () => {
    const html = await renderToString(<TaskProgress completed={2} total={10} />);
    expect(html).toContain('data-testid="task-progress"');
  });
});
