import { useState } from "react";
import { useDashboardStore } from "../context";

export const CreateTaskForm = () => {
  const [description, setDescription] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const createTask = useDashboardStore((s) => s.createTaskSimple);
  const taskCreate = useDashboardStore((s) => s.taskCreate);
  const sendTaskCreateInput = useDashboardStore((s) => s.sendTaskCreateInput);
  const clearTaskCreateOutput = useDashboardStore(
    (s) => s.clearTaskCreateOutput
  );
  const [inputLine, setInputLine] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!description.trim() || isSubmitting) return;

    setIsSubmitting(true);
    try {
      await createTask(description.trim());
      setDescription("");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const handleInputSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputLine.trim()) return;
    await sendTaskCreateInput(inputLine.trim());
    setInputLine("");
  };

  return (
    <div>
      <form className="create-task-form" onSubmit={handleSubmit}>
        <input
          type="text"
          className="create-task-input"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Describe your task..."
          disabled={isSubmitting}
        />
        <button
          type="submit"
          className="create-task-btn"
          disabled={!description.trim() || isSubmitting}
        >
          {isSubmitting ? "Creating..." : "Create"}
        </button>
      </form>

      {taskCreate.runId && (
        <div style={{ marginTop: "8px" }}>
          <div style={{ fontSize: "12px", opacity: 0.7 }}>
            Task create session: {taskCreate.runId}
          </div>
          <pre
            style={{
              maxHeight: "200px",
              overflow: "auto",
              background: "#0f0f0f",
              color: "#e6e6e6",
              padding: "8px",
              borderRadius: "4px",
              fontSize: "12px"
            }}
          >
            {taskCreate.output.join("\n")}
          </pre>
          {taskCreate.status === "running" && (
            <form onSubmit={handleInputSubmit} style={{ display: "flex" }}>
              <input
                type="text"
                value={inputLine}
                onChange={(e) => setInputLine(e.target.value)}
                placeholder="Type response and press Enter..."
                style={{ flex: 1, marginRight: "6px" }}
              />
              <button type="submit">Send</button>
            </form>
          )}
          {taskCreate.status !== "running" && (
            <button
              type="button"
              onClick={() => clearTaskCreateOutput()}
              style={{ marginTop: "6px" }}
            >
              Clear
            </button>
          )}
        </div>
      )}
    </div>
  );
};
