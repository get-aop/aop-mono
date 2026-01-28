import { describe, expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import type { AcceptanceCriterion } from "../types";
import { Checklist, type ChecklistProps } from "./Checklist";

const defaultProps: ChecklistProps = {
  criteria: [],
  checkedItems: new Set(),
  onToggle: () => {}
};

const renderChecklist = (overrides: Partial<ChecklistProps> = {}) => {
  return renderToString(<Checklist {...defaultProps} {...overrides} />);
};

const createCriteria = (
  items: { text: string; checked?: boolean }[]
): AcceptanceCriterion[] => {
  return items.map((item) => ({
    text: item.text,
    checked: item.checked ?? false
  }));
};

describe("Checklist", () => {
  test("renders checklist container", () => {
    const html = renderChecklist();
    expect(html).toContain("checklist");
  });

  test("renders checklist title", () => {
    const html = renderChecklist();
    expect(html).toContain("Acceptance Criteria");
  });

  test("renders empty state when no criteria", () => {
    const html = renderChecklist({ criteria: [] });
    expect(html).toContain("No acceptance criteria");
  });

  test("renders criteria items", () => {
    const criteria = createCriteria([
      { text: "User can log in with email/password" },
      { text: "Session persists across page refresh" }
    ]);
    const html = renderChecklist({ criteria });
    expect(html).toContain("User can log in with email/password");
    expect(html).toContain("Session persists across page refresh");
  });

  test("renders checkboxes for each criterion", () => {
    const criteria = createCriteria([
      { text: "First criterion" },
      { text: "Second criterion" }
    ]);
    const html = renderChecklist({ criteria });
    expect(html).toContain('type="checkbox"');
  });

  test("shows checked state from checkedItems set", () => {
    const criteria = createCriteria([
      { text: "First criterion" },
      { text: "Second criterion" }
    ]);
    const checkedItems = new Set([0]);
    const html = renderChecklist({ criteria, checkedItems });
    expect(html).toContain("checked");
  });

  test("renders criterion text as label", () => {
    const criteria = createCriteria([{ text: "Test criterion text" }]);
    const html = renderChecklist({ criteria });
    expect(html).toContain("checklist-label");
    expect(html).toContain("Test criterion text");
  });

  test("renders checklist item container for each criterion", () => {
    const criteria = createCriteria([
      { text: "First" },
      { text: "Second" },
      { text: "Third" }
    ]);
    const html = renderChecklist({ criteria });
    expect(html).toContain("checklist-item");
  });

  test("shows completion count", () => {
    const criteria = createCriteria([
      { text: "First" },
      { text: "Second" },
      { text: "Third" }
    ]);
    const checkedItems = new Set([0, 2]);
    const html = renderChecklist({ criteria, checkedItems });
    expect(html).toContain("2");
    expect(html).toContain("3");
  });

  test("applies checked class to checked items", () => {
    const criteria = createCriteria([{ text: "Checked item" }]);
    const checkedItems = new Set([0]);
    const html = renderChecklist({ criteria, checkedItems });
    expect(html).toContain("checked");
  });
});
