import { describe, expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import { getAvailableTransitions, StatusToggle } from "./StatusToggle";

describe("getAvailableTransitions", () => {
  test("returns Start action for BACKLOG status", () => {
    const transitions = getAvailableTransitions("BACKLOG");
    expect(transitions).toEqual([{ label: "Start", targetStatus: "PENDING" }]);
  });

  test("returns Defer action for PENDING status", () => {
    const transitions = getAvailableTransitions("PENDING");
    expect(transitions).toEqual([{ label: "Defer", targetStatus: "BACKLOG" }]);
  });

  test("returns Unblock action for BLOCKED status", () => {
    const transitions = getAvailableTransitions("BLOCKED");
    expect(transitions).toEqual([
      { label: "Unblock", targetStatus: "PENDING" }
    ]);
  });

  test("returns empty array for INPROGRESS status", () => {
    const transitions = getAvailableTransitions("INPROGRESS");
    expect(transitions).toEqual([]);
  });

  test("returns empty array for DONE status", () => {
    const transitions = getAvailableTransitions("DONE");
    expect(transitions).toEqual([]);
  });

  test("returns empty array for REVIEW status", () => {
    const transitions = getAvailableTransitions("REVIEW");
    expect(transitions).toEqual([]);
  });

  test("returns empty array for DRAFT status", () => {
    const transitions = getAvailableTransitions("DRAFT");
    expect(transitions).toEqual([]);
  });
});

describe("StatusToggle", () => {
  test("renders nothing when no transitions available", () => {
    const html = renderToString(
      <StatusToggle status="INPROGRESS" onTransition={() => {}} />
    );
    expect(html).toBe("");
  });

  test("renders button for BACKLOG with Start label", () => {
    const html = renderToString(
      <StatusToggle status="BACKLOG" onTransition={() => {}} />
    );
    expect(html).toContain("Start");
    expect(html).toContain("status-toggle");
  });

  test("renders button for PENDING with Defer label", () => {
    const html = renderToString(
      <StatusToggle status="PENDING" onTransition={() => {}} />
    );
    expect(html).toContain("Defer");
  });

  test("renders button for BLOCKED with Unblock label", () => {
    const html = renderToString(
      <StatusToggle status="BLOCKED" onTransition={() => {}} />
    );
    expect(html).toContain("Unblock");
  });

  test("applies disabled state when disabled prop is true", () => {
    const html = renderToString(
      <StatusToggle status="BACKLOG" onTransition={() => {}} disabled />
    );
    expect(html).toContain("disabled");
  });

  test("applies status-specific class", () => {
    const html = renderToString(
      <StatusToggle status="BLOCKED" onTransition={() => {}} />
    );
    expect(html).toContain("status-toggle-blocked");
  });
});
