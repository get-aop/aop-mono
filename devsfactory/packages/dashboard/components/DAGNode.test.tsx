import { describe, expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import type { Subtask, SubtaskStatus } from "../types";
import { DAGNode, getStatusStyle } from "./DAGNode";

const makeSubtask = (status: SubtaskStatus, title = "Test Task"): Subtask => ({
  filename: "001-test.md",
  number: 1,
  slug: "test",
  frontmatter: { title, status, dependencies: [] },
  description: ""
});

describe("getStatusStyle", () => {
  test("returns gray for PENDING", () => {
    const style = getStatusStyle("PENDING");
    expect(style.borderColor).toBe("#9ca3af");
    expect(style.fillColor).toBe("#ffffff");
  });

  test("returns blue for INPROGRESS", () => {
    const style = getStatusStyle("INPROGRESS");
    expect(style.borderColor).toBe("#3b82f6");
    expect(style.fillColor).toBe("#dbeafe");
  });

  test("returns yellow for AGENT_REVIEW", () => {
    const style = getStatusStyle("AGENT_REVIEW");
    expect(style.borderColor).toBe("#eab308");
    expect(style.fillColor).toBe("#fef9c3");
  });

  test("returns yellow for PENDING_MERGE", () => {
    const style = getStatusStyle("PENDING_MERGE");
    expect(style.borderColor).toBe("#eab308");
    expect(style.fillColor).toBe("#fef9c3");
  });

  test("returns red for MERGE_CONFLICT", () => {
    const style = getStatusStyle("MERGE_CONFLICT");
    expect(style.borderColor).toBe("#ef4444");
    expect(style.fillColor).toBe("#fee2e2");
  });

  test("returns red for BLOCKED", () => {
    const style = getStatusStyle("BLOCKED");
    expect(style.borderColor).toBe("#ef4444");
    expect(style.fillColor).toBe("#fee2e2");
  });

  test("returns green for DONE", () => {
    const style = getStatusStyle("DONE");
    expect(style.borderColor).toBe("#22c55e");
    expect(style.fillColor).toBe("#dcfce7");
  });
});

describe("DAGNode", () => {
  test("renders an SVG group with rect and text", () => {
    const html = renderToString(
      <svg role="img" aria-label="test">
        <DAGNode
          subtask={makeSubtask("PENDING")}
          x={0}
          y={0}
          width={160}
          height={60}
        />
      </svg>
    );
    expect(html).toContain("<g");
    expect(html).toContain("<rect");
    expect(html).toContain("<text");
  });

  test("positions group at specified coordinates", () => {
    const html = renderToString(
      <svg role="img" aria-label="test">
        <DAGNode
          subtask={makeSubtask("PENDING")}
          x={100}
          y={200}
          width={160}
          height={60}
        />
      </svg>
    );
    expect(html).toContain('transform="translate(100, 200)"');
  });

  test("renders rect with correct dimensions", () => {
    const html = renderToString(
      <svg role="img" aria-label="test">
        <DAGNode
          subtask={makeSubtask("PENDING")}
          x={0}
          y={0}
          width={180}
          height={70}
        />
      </svg>
    );
    expect(html).toContain('width="180"');
    expect(html).toContain('height="70"');
  });

  test("displays subtask title", () => {
    const html = renderToString(
      <svg role="img" aria-label="test">
        <DAGNode
          subtask={makeSubtask("PENDING", "My Subtask")}
          x={0}
          y={0}
          width={160}
          height={60}
        />
      </svg>
    );
    expect(html).toContain("My Subtask");
  });

  test("applies correct fill color based on status", () => {
    const html = renderToString(
      <svg role="img" aria-label="test">
        <DAGNode
          subtask={makeSubtask("DONE")}
          x={0}
          y={0}
          width={160}
          height={60}
        />
      </svg>
    );
    expect(html).toContain("#dcfce7");
  });

  test("applies correct border color based on status", () => {
    const html = renderToString(
      <svg role="img" aria-label="test">
        <DAGNode
          subtask={makeSubtask("BLOCKED")}
          x={0}
          y={0}
          width={160}
          height={60}
        />
      </svg>
    );
    expect(html).toContain("#ef4444");
  });

  test("adds pulse class when agent is active", () => {
    const html = renderToString(
      <svg role="img" aria-label="test">
        <DAGNode
          subtask={makeSubtask("INPROGRESS")}
          x={0}
          y={0}
          width={160}
          height={60}
          hasActiveAgent
        />
      </svg>
    );
    expect(html).toContain("dag-node-pulse");
  });

  test("does not add pulse class when no active agent", () => {
    const html = renderToString(
      <svg role="img" aria-label="test">
        <DAGNode
          subtask={makeSubtask("INPROGRESS")}
          x={0}
          y={0}
          width={160}
          height={60}
        />
      </svg>
    );
    expect(html).not.toContain("dag-node-pulse");
  });

  test("sets cursor to pointer for clickable nodes", () => {
    const html = renderToString(
      <svg role="img" aria-label="test">
        <DAGNode
          subtask={makeSubtask("PENDING")}
          x={0}
          y={0}
          width={160}
          height={60}
          onClick={() => {}}
        />
      </svg>
    );
    expect(html).toContain("cursor:pointer");
  });

  test("displays subtask number", () => {
    const subtask = makeSubtask("PENDING");
    subtask.number = 5;
    const html = renderToString(
      <svg role="img" aria-label="test">
        <DAGNode subtask={subtask} x={0} y={0} width={160} height={60} />
      </svg>
    );
    expect(html).toContain("#");
    expect(html).toContain(">5<");
  });

  test("renders unblock button for BLOCKED subtask when onUnblock provided", () => {
    const subtask = makeSubtask("BLOCKED");
    const html = renderToString(
      <svg role="img" aria-label="test">
        <DAGNode
          subtask={subtask}
          x={0}
          y={0}
          width={160}
          height={60}
          onUnblock={() => {}}
        />
      </svg>
    );
    expect(html).toContain("Unblock");
    expect(html).toContain("dag-node-unblock");
  });

  test("does not render unblock button for non-BLOCKED subtask", () => {
    const subtask = makeSubtask("PENDING");
    const html = renderToString(
      <svg role="img" aria-label="test">
        <DAGNode
          subtask={subtask}
          x={0}
          y={0}
          width={160}
          height={60}
          onUnblock={() => {}}
        />
      </svg>
    );
    expect(html).not.toContain("Unblock");
    expect(html).not.toContain("dag-node-unblock");
  });

  test("does not render unblock button when onUnblock not provided", () => {
    const subtask = makeSubtask("BLOCKED");
    const html = renderToString(
      <svg role="img" aria-label="test">
        <DAGNode subtask={subtask} x={0} y={0} width={160} height={60} />
      </svg>
    );
    expect(html).not.toContain("Unblock");
    expect(html).not.toContain("dag-node-unblock");
  });
});
