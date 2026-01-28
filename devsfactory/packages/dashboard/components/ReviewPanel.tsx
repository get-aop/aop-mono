import { useEffect, useState } from "react";
import { useDashboardStore } from "../context";
import type { Task } from "../types";
import { Checklist } from "./Checklist";
import { DiffViewer } from "./DiffViewer";

export interface ReviewPanelProps {
  task: Task;
  diff: string | null;
  diffLoading: boolean;
  diffError: string | null;
  prUrl: string | null;
  prLoading: boolean;
  onCreatePr: () => Promise<void>;
}

export const ReviewPanel = ({
  task,
  diff,
  diffLoading,
  diffError,
  prUrl,
  prLoading,
  onCreatePr
}: ReviewPanelProps) => {
  const [checkedItems, setCheckedItems] = useState<Set<number>>(new Set());

  const handleToggle = (index: number) => {
    setCheckedItems((prev) => {
      const next = new Set(prev);
      next.has(index) ? next.delete(index) : next.add(index);
      return next;
    });
  };

  const handleCreatePr = async () => {
    const uncheckedCount = task.acceptanceCriteria.length - checkedItems.size;
    if (uncheckedCount > 0) {
      const confirmed = confirm(
        `${uncheckedCount} acceptance criteria are not checked. Create PR anyway?`
      );
      if (!confirmed) return;
    }
    await onCreatePr();
  };

  return (
    <div className="review-panel">
      <div className="review-panel-header">
        <h2>Review: {task.folder}</h2>
        <div className="review-panel-actions">
          {prUrl ? (
            <a
              href={prUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="pr-link"
            >
              {prUrl}
            </a>
          ) : (
            <button
              type="button"
              className="create-pr-button"
              onClick={handleCreatePr}
              disabled={prLoading}
            >
              {prLoading ? "Creating PR..." : "Create PR"}
            </button>
          )}
        </div>
      </div>

      <div className="review-panel-content">
        <Checklist
          criteria={task.acceptanceCriteria}
          checkedItems={checkedItems}
          onToggle={handleToggle}
        />

        <div className="review-panel-diff">
          <h3>Changes (task/{task.folder} → main)</h3>
          <DiffViewer diff={diff} loading={diffLoading} error={diffError} />
        </div>
      </div>
    </div>
  );
};

export interface ConnectedReviewPanelProps {
  task: Task;
}

export const ConnectedReviewPanel = ({ task }: ConnectedReviewPanelProps) => {
  const fetchDiff = useDashboardStore((s) => s.fetchDiff);
  const createPullRequest = useDashboardStore((s) => s.createPullRequest);

  const [diff, setDiff] = useState<string | null>(null);
  const [diffLoading, setDiffLoading] = useState(true);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [prUrl, setPrUrl] = useState<string | null>(null);
  const [prLoading, setPrLoading] = useState(false);

  useEffect(() => {
    setDiffLoading(true);
    setDiffError(null);
    fetchDiff(task.folder)
      .then((result) => setDiff(result.diff))
      .catch((err) => setDiffError(err.message))
      .finally(() => setDiffLoading(false));
  }, [task.folder, fetchDiff]);

  const handleCreatePr = async () => {
    setPrLoading(true);
    try {
      const result = await createPullRequest(task.folder);
      setPrUrl(result.prUrl);
    } finally {
      setPrLoading(false);
    }
  };

  return (
    <ReviewPanel
      task={task}
      diff={diff}
      diffLoading={diffLoading}
      diffError={diffError}
      prUrl={prUrl}
      prLoading={prLoading}
      onCreatePr={handleCreatePr}
    />
  );
};
