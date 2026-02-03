import { useDashboardStore } from "../context";
import type { Subtask } from "../types";

export interface DAGViewProps {
  subtasks: Subtask[];
  taskFolder: string;
}

const getStatusBadge = (status: string) => {
  const colors: Record<string, string> = {
    PENDING: "#fbbf24",
    INPROGRESS: "#3b82f6",
    DONE: "#22c55e",
    BLOCKED: "#ef4444",
    REVIEW: "#a855f7"
  };
  return colors[status] || "#6b7280";
};

export const DAGView = ({ subtasks, taskFolder }: DAGViewProps) => {
  const activeAgents = useDashboardStore((s) => s.activeAgents);
  const selectedSubtask = useDashboardStore((s) => s.selectedSubtask);
  const selectSubtask = useDashboardStore((s) => s.selectSubtask);

  const hasActiveAgent = (subtask: Subtask) =>
    Array.from(activeAgents.values()).some(
      (agent) =>
        agent.taskFolder === taskFolder &&
        agent.subtaskFile === subtask.filename
    );

  const isSelected = (subtask: Subtask) =>
    selectedSubtask?.taskFolder === taskFolder &&
    selectedSubtask?.subtaskFile === subtask.filename;

  return (
    <div className="dag-view" style={{ padding: "1rem" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
          gap: "1rem"
        }}
      >
        {subtasks.map((subtask) => (
          // biome-ignore lint/a11y/useSemanticElements: Using div for custom card styling
          <div
            key={subtask.filename}
            role="button"
            tabIndex={0}
            onClick={() => selectSubtask(taskFolder, subtask.filename)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                selectSubtask(taskFolder, subtask.filename);
              }
            }}
            style={{
              padding: "1rem",
              borderRadius: "8px",
              border: isSelected(subtask)
                ? "2px solid #3b82f6"
                : "1px solid #374151",
              backgroundColor: isSelected(subtask) ? "#1e3a5f" : "#1f2937",
              cursor: "pointer",
              transition: "all 0.2s"
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                marginBottom: "0.5rem"
              }}
            >
              <span
                style={{
                  width: "10px",
                  height: "10px",
                  borderRadius: "50%",
                  backgroundColor: getStatusBadge(subtask.frontmatter.status),
                  display: "inline-block"
                }}
              />
              <span style={{ fontWeight: "bold", color: "#f3f4f6" }}>
                {subtask.number}. {subtask.frontmatter.title}
              </span>
              {hasActiveAgent(subtask) && (
                <span
                  style={{
                    marginLeft: "auto",
                    fontSize: "0.75rem",
                    padding: "2px 6px",
                    borderRadius: "4px",
                    backgroundColor: "#3b82f6",
                    color: "white"
                  }}
                >
                  Running
                </span>
              )}
            </div>
            <div style={{ fontSize: "0.875rem", color: "#9ca3af" }}>
              {subtask.frontmatter.status}
              {subtask.frontmatter.dependencies.length > 0 && (
                <span>
                  {" "}
                  • Deps: {subtask.frontmatter.dependencies.join(", ")}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
