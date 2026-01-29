import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { fireEvent, render } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import { renderToString } from "react-dom/server";
import type { Subtask, SubtaskStatus } from "../types";
import { SubtaskNode, type SubtaskNodeData } from "./SubtaskNode";

const makeSubtask = (status: SubtaskStatus, title = "Test Task"): Subtask => ({
  filename: "001-test.md",
  number: 1,
  slug: "test",
  frontmatter: { title, status, dependencies: [] },
  description: ""
});

const makeNodeProps = (
  overrides: Partial<SubtaskNodeData> = {}
): { id: string; data: SubtaskNodeData } => ({
  id: "node-1",
  data: {
    subtask: makeSubtask("PENDING"),
    hasActiveAgent: false,
    isSelected: false,
    onSelect: () => {},
    onUnblock: () => {},
    ...overrides
  }
});

const renderNode = (props: ReturnType<typeof makeNodeProps>) =>
  renderToString(
    <ReactFlowProvider>
      <SubtaskNode {...props} />
    </ReactFlowProvider>
  );

describe("SubtaskNode", () => {
  test("renders a div container", () => {
    const html = renderNode(makeNodeProps());
    expect(html).toContain("<div");
  });

  test("displays subtask number", () => {
    const subtask = makeSubtask("PENDING");
    subtask.number = 5;
    const html = renderNode(makeNodeProps({ subtask }));
    expect(html).toContain("#");
    expect(html).toContain(">5<");
  });

  test("displays subtask title", () => {
    const subtask = makeSubtask("PENDING", "My Subtask");
    const html = renderNode(makeNodeProps({ subtask }));
    expect(html).toContain("My Subtask");
  });

  test("applies correct fill color based on status - PENDING", () => {
    const subtask = makeSubtask("PENDING");
    const html = renderNode(makeNodeProps({ subtask }));
    expect(html).toContain("background:#ffffff");
  });

  test("applies correct border color based on status - PENDING", () => {
    const subtask = makeSubtask("PENDING");
    const html = renderNode(makeNodeProps({ subtask }));
    expect(html).toContain("border-color:#9ca3af");
  });

  test("applies correct colors for DONE status", () => {
    const subtask = makeSubtask("DONE");
    const html = renderNode(makeNodeProps({ subtask }));
    expect(html).toContain("background:#dcfce7");
    expect(html).toContain("border-color:#22c55e");
  });

  test("applies correct colors for INPROGRESS status", () => {
    const subtask = makeSubtask("INPROGRESS");
    const html = renderNode(makeNodeProps({ subtask }));
    expect(html).toContain("background:#dbeafe");
    expect(html).toContain("border-color:#3b82f6");
  });

  test("applies correct colors for BLOCKED status", () => {
    const subtask = makeSubtask("BLOCKED");
    const html = renderNode(makeNodeProps({ subtask }));
    expect(html).toContain("background:#fee2e2");
    expect(html).toContain("border-color:#ef4444");
  });

  test("applies correct colors for AGENT_REVIEW status", () => {
    const subtask = makeSubtask("AGENT_REVIEW");
    const html = renderNode(makeNodeProps({ subtask }));
    expect(html).toContain("background:#fef9c3");
    expect(html).toContain("border-color:#eab308");
  });

  test("applies correct colors for PENDING_MERGE status", () => {
    const subtask = makeSubtask("PENDING_MERGE");
    const html = renderNode(makeNodeProps({ subtask }));
    expect(html).toContain("background:#fef9c3");
    expect(html).toContain("border-color:#eab308");
  });

  test("applies correct colors for MERGE_CONFLICT status", () => {
    const subtask = makeSubtask("MERGE_CONFLICT");
    const html = renderNode(makeNodeProps({ subtask }));
    expect(html).toContain("background:#fee2e2");
    expect(html).toContain("border-color:#ef4444");
  });

  test("adds pulse class when agent is active", () => {
    const html = renderNode(makeNodeProps({ hasActiveAgent: true }));
    expect(html).toContain("dag-node-pulse");
  });

  test("does not add pulse class when no active agent", () => {
    const html = renderNode(makeNodeProps({ hasActiveAgent: false }));
    expect(html).not.toContain("dag-node-pulse");
  });

  test("applies blue border when selected", () => {
    const html = renderNode(makeNodeProps({ isSelected: true }));
    expect(html).toContain("border-color:#3b82f6");
    expect(html).toContain("border-width:3px");
  });

  test("applies status border when not selected", () => {
    const subtask = makeSubtask("DONE");
    const html = renderNode(makeNodeProps({ subtask, isSelected: false }));
    expect(html).toContain("border-color:#22c55e");
    expect(html).toContain("border-width:2px");
  });

  test("renders left handle for input connections", () => {
    const html = renderNode(makeNodeProps());
    expect(html).toContain('data-handlepos="left"');
  });

  test("renders right handle for output connections", () => {
    const html = renderNode(makeNodeProps());
    expect(html).toContain('data-handlepos="right"');
  });

  test("renders unblock button for BLOCKED subtask", () => {
    const subtask = makeSubtask("BLOCKED");
    const html = renderNode(makeNodeProps({ subtask }));
    expect(html).toContain("Unblock");
    expect(html).toContain("dag-node-unblock");
  });

  test("does not render unblock button for non-BLOCKED subtask", () => {
    const subtask = makeSubtask("PENDING");
    const html = renderNode(makeNodeProps({ subtask }));
    expect(html).not.toContain("Unblock");
    expect(html).not.toContain("dag-node-unblock");
  });

  test("sets cursor to pointer for clickable interaction", () => {
    const html = renderNode(makeNodeProps());
    expect(html).toContain("cursor:pointer");
  });

  test("has proper text truncation styles", () => {
    const subtask = makeSubtask(
      "PENDING",
      "Very Long Title That Should Be Truncated"
    );
    const html = renderNode(makeNodeProps({ subtask }));
    expect(html).toContain("text-overflow:ellipsis");
    expect(html).toContain("overflow:hidden");
    expect(html).toContain("white-space:nowrap");
  });

  test("has max-width constraint for truncation", () => {
    const html = renderNode(makeNodeProps());
    expect(html).toContain("max-width:");
  });
});

describe("SubtaskNode interactions", () => {
  beforeAll(() => {
    GlobalRegistrator.register();
  });

  afterAll(() => {
    GlobalRegistrator.unregister();
  });

  const renderWithProvider = (props: ReturnType<typeof makeNodeProps>) =>
    render(
      <ReactFlowProvider>
        <SubtaskNode {...props} />
      </ReactFlowProvider>
    );

  test("clicking node calls onSelect handler", () => {
    const onSelect = mock(() => {});
    const { container } = renderWithProvider(makeNodeProps({ onSelect }));

    const node = container.querySelector('[role="button"]');
    expect(node).not.toBeNull();
    fireEvent.click(node!);

    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  test("clicking unblock button calls onUnblock handler", () => {
    const onUnblock = mock(() => {});
    const subtask = makeSubtask("BLOCKED");
    const { container } = renderWithProvider(
      makeNodeProps({ subtask, onUnblock })
    );

    const unblockButton = container.querySelector(".dag-node-unblock");
    expect(unblockButton).not.toBeNull();
    fireEvent.click(unblockButton!);

    expect(onUnblock).toHaveBeenCalledTimes(1);
  });

  test("clicking unblock button does not trigger onSelect", () => {
    const onSelect = mock(() => {});
    const onUnblock = mock(() => {});
    const subtask = makeSubtask("BLOCKED");
    const { container } = renderWithProvider(
      makeNodeProps({ subtask, onSelect, onUnblock })
    );

    const unblockButton = container.querySelector(".dag-node-unblock");
    fireEvent.click(unblockButton!);

    expect(onUnblock).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledTimes(0);
  });

  test("pressing Enter on node triggers onSelect", () => {
    const onSelect = mock(() => {});
    const { container } = renderWithProvider(makeNodeProps({ onSelect }));

    const node = container.querySelector('[role="button"]');
    fireEvent.keyDown(node!, { key: "Enter" });

    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});
