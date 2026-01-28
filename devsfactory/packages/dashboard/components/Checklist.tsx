import type { AcceptanceCriterion } from "../types";

export interface ChecklistProps {
  criteria: AcceptanceCriterion[];
  checkedItems: Set<number>;
  onToggle: (index: number) => void;
}

export const Checklist = ({
  criteria,
  checkedItems,
  onToggle
}: ChecklistProps) => {
  const checkedCount = checkedItems.size;
  const totalCount = criteria.length;

  return (
    <div className="checklist">
      <div className="checklist-header">
        <h3>Acceptance Criteria</h3>
        {totalCount > 0 && (
          <span className="checklist-count">
            {checkedCount} / {totalCount}
          </span>
        )}
      </div>
      {criteria.length === 0 ? (
        <div className="checklist-empty">No acceptance criteria</div>
      ) : (
        <div className="checklist-items">
          {criteria.map((criterion, index) => (
            <div
              key={criterion.text}
              className={`checklist-item ${checkedItems.has(index) ? "checked" : ""}`}
            >
              <input
                type="checkbox"
                id={`criterion-${index}`}
                checked={checkedItems.has(index)}
                onChange={() => onToggle(index)}
                className="checklist-checkbox"
              />
              <label htmlFor={`criterion-${index}`} className="checklist-label">
                {criterion.text}
              </label>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
