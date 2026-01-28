import { describe, expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import { StatusBadge } from "./StatusBadge";

describe("StatusBadge", () => {
  test("renders DRAFT status with gray-dim color", () => {
    const html = renderToString(<StatusBadge status="DRAFT" />);
    expect(html).toContain("DRAFT");
    expect(html).toContain("status-draft");
  });

  test("renders BACKLOG status with gray color", () => {
    const html = renderToString(<StatusBadge status="BACKLOG" />);
    expect(html).toContain("BACKLOG");
    expect(html).toContain("status-backlog");
  });

  test("renders PENDING status with gray color and ready indicator", () => {
    const html = renderToString(<StatusBadge status="PENDING" />);
    expect(html).toContain("PENDING");
    expect(html).toContain("status-pending");
  });

  test("renders INPROGRESS status with blue color", () => {
    const html = renderToString(<StatusBadge status="INPROGRESS" />);
    expect(html).toContain("INPROGRESS");
    expect(html).toContain("status-inprogress");
  });

  test("renders BLOCKED status with red color", () => {
    const html = renderToString(<StatusBadge status="BLOCKED" />);
    expect(html).toContain("BLOCKED");
    expect(html).toContain("status-blocked");
  });

  test("renders REVIEW status with yellow color", () => {
    const html = renderToString(<StatusBadge status="REVIEW" />);
    expect(html).toContain("REVIEW");
    expect(html).toContain("status-review");
  });

  test("renders DONE status with green color", () => {
    const html = renderToString(<StatusBadge status="DONE" />);
    expect(html).toContain("DONE");
    expect(html).toContain("status-done");
  });

  test("shows pulsing indicator when active", () => {
    const html = renderToString(<StatusBadge status="INPROGRESS" active />);
    expect(html).toContain("pulsing");
  });

  test("does not show pulsing indicator when not active", () => {
    const html = renderToString(<StatusBadge status="INPROGRESS" />);
    expect(html).not.toContain("pulsing");
  });
});
