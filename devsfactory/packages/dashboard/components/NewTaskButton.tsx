import { useDashboardStore } from "../context";

export const NewTaskButton = () => {
  const openModal = useDashboardStore((s) => s.openModal);
  const hasActiveDrafts = useDashboardStore(
    (s) => s.brainstorm.drafts.length > 0
  );

  return (
    <button type="button" className="create-task-button" onClick={openModal}>
      + New Task
      {hasActiveDrafts && <span className="draft-indicator" />}
    </button>
  );
};
