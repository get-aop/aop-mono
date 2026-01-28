import { useEffect, useRef } from "react";
import { useDashboardStore } from "../context";
import type { ActiveAgent } from "../types";
import { DebugStream } from "./DebugStream";
import { type ActivityEvent, EventLine } from "./EventLine";

const parseOutputToEvents = (
  agentId: string,
  lines: string[]
): ActivityEvent[] => {
  const baseTime = Date.now();
  const events: ActivityEvent[] = [];
  for (let i = 0; i < lines.length; i++) {
    const action = lines[i].trim();
    if (action) {
      events.push({
        timestamp: new Date(baseTime + i * 1000),
        agentId,
        action
      });
    }
  }
  return events;
};

export interface ActivityFeedProps {
  activeAgents: Map<string, ActiveAgent>;
  agentOutputs: Map<string, string[]>;
  focusedAgent: string | null;
  isPinned: boolean;
  debugMode: boolean;
  onFocusAgent: (agentId: string, pin?: boolean) => void;
}

export const ActivityFeed = ({
  activeAgents,
  agentOutputs,
  focusedAgent,
  isPinned,
  debugMode,
  onFocusAgent
}: ActivityFeedProps) => {
  const summaryRef = useRef<HTMLDivElement>(null);
  const agentIds = Array.from(activeAgents.keys());
  const hasAgents = agentIds.length > 0;
  const focusedOutput = focusedAgent
    ? (agentOutputs.get(focusedAgent) ?? [])
    : [];
  const events = focusedAgent
    ? parseOutputToEvents(focusedAgent, focusedOutput)
    : [];

  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional scroll on content change
  useEffect(() => {
    if (summaryRef.current) {
      summaryRef.current.scrollTop = summaryRef.current.scrollHeight;
    }
  }, [focusedOutput.length]);

  const handlePin = () => {
    if (focusedAgent) {
      onFocusAgent(focusedAgent, !isPinned);
    }
  };

  const handleTabClick = (agentId: string) => {
    onFocusAgent(agentId, isPinned);
  };

  return (
    <div className="activity-feed">
      <div className="activity-feed-header">
        <h3>Activity Feed</h3>
        {focusedAgent && !isPinned && (
          <span className="following-indicator">following</span>
        )}
        {focusedAgent && (
          <button
            type="button"
            className={`pin-button ${isPinned ? "pinned" : ""}`}
            onClick={handlePin}
          >
            {isPinned ? "pinned" : "pin"}
          </button>
        )}
      </div>

      {!hasAgents ? (
        <div className="activity-feed-empty">No active agents</div>
      ) : (
        <>
          <div className="agent-tabs">
            {agentIds.map((agentId) => (
              <button
                key={agentId}
                type="button"
                className={`agent-tab ${focusedAgent === agentId ? "focused" : ""}`}
                onClick={() => handleTabClick(agentId)}
              >
                {agentId}
              </button>
            ))}
          </div>

          <div className="activity-feed-content">
            {debugMode ? (
              <DebugStream lines={focusedOutput} />
            ) : (
              <div ref={summaryRef} className="summary-view">
                {events.map((event, idx) => (
                  <EventLine
                    // biome-ignore lint/suspicious/noArrayIndexKey: events are append-only with no stable IDs
                    key={idx}
                    event={event}
                    isActive={activeAgents.has(event.agentId)}
                    onClick={() => onFocusAgent(event.agentId)}
                  />
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export const ConnectedActivityFeed = () => {
  const activeAgents = useDashboardStore((s) => s.activeAgents);
  const agentOutputs = useDashboardStore((s) => s.agentOutputs);
  const focusedAgent = useDashboardStore((s) => s.focusedAgent);
  const isPinned = useDashboardStore((s) => s.isPinned);
  const debugMode = useDashboardStore((s) => s.debugMode);
  const focusAgent = useDashboardStore((s) => s.focusAgent);

  return (
    <ActivityFeed
      activeAgents={activeAgents}
      agentOutputs={agentOutputs}
      focusedAgent={focusedAgent}
      isPinned={isPinned}
      debugMode={debugMode}
      onFocusAgent={focusAgent}
    />
  );
};
