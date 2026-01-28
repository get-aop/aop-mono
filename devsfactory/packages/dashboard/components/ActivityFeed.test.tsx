import { describe, expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import type { ActiveAgent, AgentType } from "../types";
import { ActivityFeed, type ActivityFeedProps } from "./ActivityFeed";
import { DebugStream } from "./DebugStream";
import { type ActivityEvent, EventLine } from "./EventLine";

const defaultProps: ActivityFeedProps = {
  activeAgents: new Map(),
  agentOutputs: new Map(),
  focusedAgent: null,
  isPinned: false,
  debugMode: false,
  onFocusAgent: () => {}
};

const renderActivityFeed = (overrides: Partial<ActivityFeedProps> = {}) => {
  return renderToString(<ActivityFeed {...defaultProps} {...overrides} />);
};

const createActiveAgent = (
  taskFolder: string,
  type: AgentType,
  subtaskFile?: string
): ActiveAgent => ({
  taskFolder,
  type,
  subtaskFile
});

describe("EventLine", () => {
  const baseEvent: ActivityEvent = {
    timestamp: new Date("2026-01-27T10:45:02"),
    agentId: "003-feature",
    action: "Agent started (implementation)"
  };

  test("renders timestamp in HH:MM:SS format", () => {
    const html = renderToString(
      <EventLine event={baseEvent} isActive={false} />
    );
    expect(html).toContain("10:45:02");
  });

  test("renders agent ID", () => {
    const html = renderToString(
      <EventLine event={baseEvent} isActive={false} />
    );
    expect(html).toContain("003-feature");
  });

  test("renders action text", () => {
    const html = renderToString(
      <EventLine event={baseEvent} isActive={false} />
    );
    expect(html).toContain("Agent started (implementation)");
  });

  test("shows active indicator when agent is active", () => {
    const html = renderToString(
      <EventLine event={baseEvent} isActive={true} />
    );
    expect(html).toContain("active");
  });

  test("renders tool action format", () => {
    const toolEvent: ActivityEvent = {
      timestamp: new Date("2026-01-27T10:45:15"),
      agentId: "003-feature",
      action: "[Bash] bun test"
    };
    const html = renderToString(
      <EventLine event={toolEvent} isActive={false} />
    );
    expect(html).toContain("[Bash]");
    expect(html).toContain("bun test");
  });

  test("renders commit action format", () => {
    const commitEvent: ActivityEvent = {
      timestamp: new Date("2026-01-27T10:45:32"),
      agentId: "003-feature",
      action: "Committed: feat: add login flow"
    };
    const html = renderToString(
      <EventLine event={commitEvent} isActive={false} />
    );
    expect(html).toContain("Committed:");
    expect(html).toContain("feat: add login flow");
  });
});

describe("DebugStream", () => {
  test("renders streaming output text", () => {
    const lines = ["Line 1", "Line 2", "Line 3"];
    const html = renderToString(<DebugStream lines={lines} />);
    expect(html).toContain("Line 1");
    expect(html).toContain("Line 2");
    expect(html).toContain("Line 3");
  });

  test("uses monospace font class", () => {
    const html = renderToString(<DebugStream lines={["test"]} />);
    expect(html).toContain("monospace");
  });

  test("preserves whitespace with pre class", () => {
    const lines = ["  indented", "\ttabbed"];
    const html = renderToString(<DebugStream lines={lines} />);
    expect(html).toContain("pre");
  });

  test("renders empty state when no output", () => {
    const html = renderToString(<DebugStream lines={[]} />);
    expect(html).toContain("debug-stream");
  });
});

describe("ActivityFeed", () => {
  test("renders activity feed container", () => {
    const html = renderActivityFeed();
    expect(html).toContain("activity-feed");
  });

  test("shows 'No active agents' when none running", () => {
    const html = renderActivityFeed();
    expect(html).toContain("No active agents");
  });

  test("renders agent tabs when agents are active", () => {
    const html = renderActivityFeed({
      activeAgents: new Map([
        [
          "agent-1",
          createActiveAgent("task-1", "implementation", "001-setup.md")
        ]
      ])
    });
    expect(html).toContain("agent-1");
  });

  test("shows pin button when agent is focused", () => {
    const html = renderActivityFeed({
      activeAgents: new Map([
        ["agent-1", createActiveAgent("task-1", "implementation")]
      ]),
      focusedAgent: "agent-1"
    });
    expect(html).toContain("pin");
  });

  test("shows pinned indicator when pinned", () => {
    const html = renderActivityFeed({
      activeAgents: new Map([
        ["agent-1", createActiveAgent("task-1", "implementation")]
      ]),
      focusedAgent: "agent-1",
      isPinned: true
    });
    expect(html).toContain("pinned");
  });

  test("shows summary view by default", () => {
    const html = renderActivityFeed({
      activeAgents: new Map([
        ["agent-1", createActiveAgent("task-1", "implementation")]
      ]),
      agentOutputs: new Map([["agent-1", ["output line"]]]),
      focusedAgent: "agent-1",
      debugMode: false
    });
    expect(html).toContain("summary-view");
  });

  test("shows debug view when debug mode enabled", () => {
    const html = renderActivityFeed({
      activeAgents: new Map([
        ["agent-1", createActiveAgent("task-1", "implementation")]
      ]),
      agentOutputs: new Map([["agent-1", ["output line"]]]),
      focusedAgent: "agent-1",
      debugMode: true
    });
    expect(html).toContain("debug-stream");
  });

  test("highlights focused agent tab", () => {
    const html = renderActivityFeed({
      activeAgents: new Map([
        ["agent-1", createActiveAgent("task-1", "implementation")],
        ["agent-2", createActiveAgent("task-2", "review")]
      ]),
      focusedAgent: "agent-1"
    });
    expect(html).toContain("focused");
  });

  test("renders multiple agent tabs", () => {
    const html = renderActivityFeed({
      activeAgents: new Map([
        ["agent-1", createActiveAgent("task-1", "implementation")],
        ["agent-2", createActiveAgent("task-2", "review")]
      ])
    });
    expect(html).toContain("agent-1");
    expect(html).toContain("agent-2");
  });

  test("shows following indicator when not pinned", () => {
    const html = renderActivityFeed({
      activeAgents: new Map([
        ["agent-1", createActiveAgent("task-1", "implementation")]
      ]),
      focusedAgent: "agent-1",
      isPinned: false
    });
    expect(html).toContain("following-indicator");
  });

  test("hides following indicator when pinned", () => {
    const html = renderActivityFeed({
      activeAgents: new Map([
        ["agent-1", createActiveAgent("task-1", "implementation")]
      ]),
      focusedAgent: "agent-1",
      isPinned: true
    });
    expect(html).not.toContain("following-indicator");
  });
});
