import { afterEach, describe, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import type { Step, Task } from "../types";
import { BlockedBanner } from "./BlockedBanner";

if (!globalThis.document || !("defaultView" in globalThis.document)) {
  const win = new Window({ url: "http://localhost" });
  for (const key of Object.getOwnPropertyNames(win)) {
    if (!(key in globalThis)) {
      Object.defineProperty(globalThis, key, {
        value: (win as unknown as Record<string, unknown>)[key],
        configurable: true,
        writable: true,
      });
    }
  }
  globalThis.document = win.document as unknown as Document;
}

const { render, screen, cleanup, fireEvent } = await import("@testing-library/react");

afterEach(cleanup);

const makeBlockedTask = (overrides: Partial<Task> = {}): Task => ({
  id: "task-1",
  repoId: "repo-1",
  repoPath: "/home/user/repos/my-repo",
  status: "BLOCKED",
  changePath: "docs/tasks/my-feature",
  baseBranch: null,
  preferredProvider: null,
  preferredWorkflow: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  errorMessage: "Step failed: review",
  ...overrides,
});

const makeStep = (overrides: Partial<Step> = {}): Step => ({
  id: "step-exec-1",
  stepId: "implement",
  stepType: "implement",
  status: "success",
  startedAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

describe("BlockedBanner", () => {
  test("renders nothing when there are no blocked tasks", () => {
    const { container } = render(<BlockedBanner tasks={[]} />);
    expect(container.innerHTML).toBe("");
  });

  test("renders banner with blocked tasks", () => {
    render(<BlockedBanner tasks={[makeBlockedTask()]} />);

    expect(screen.getByTestId("blocked-banner")).toBeDefined();
    expect(screen.getByText("1")).toBeDefined();
  });

  test("displays change name and repo name", () => {
    render(<BlockedBanner tasks={[makeBlockedTask()]} />);

    expect(screen.getByText("my-feature")).toBeDefined();
    expect(screen.getByText("my-repo")).toBeDefined();
  });

  test("displays error message", () => {
    render(<BlockedBanner tasks={[makeBlockedTask()]} />);
    expect(screen.getByText("Step failed: review")).toBeDefined();
  });

  test("calls onTaskClick when task card is clicked", () => {
    const task = makeBlockedTask();
    const onClick = mock(() => {});
    render(<BlockedBanner tasks={[task]} onTaskClick={onClick} />);

    fireEvent.click(screen.getByTestId("blocked-task-task-1"));
    expect(onClick).toHaveBeenCalledWith(task);
  });

  test("does not render a Remove button", () => {
    render(<BlockedBanner tasks={[makeBlockedTask()]} />);
    expect(screen.queryByTestId("remove-button-task-1")).toBeNull();
  });

  test("does not render a Restart button", () => {
    render(<BlockedBanner tasks={[makeBlockedTask()]} />);
    expect(screen.queryByTestId("restart-button-task-1")).toBeNull();
  });

  describe("RetryDialog", () => {
    test("renders Retry button that opens dialog", () => {
      const task = makeBlockedTask();
      const onRetry = mock(() => {});
      render(<BlockedBanner tasks={[task]} onRetry={onRetry} />);

      const btn = screen.getByTestId("retry-button-task-1");
      expect(btn.textContent).toBe("Retry");
    });

    test("opens dialog on Retry click with step options", () => {
      const task = makeBlockedTask();
      const steps = [
        makeStep({ stepId: "implement" }),
        makeStep({ id: "step-exec-2", stepId: "full-review", status: "failure" }),
      ];
      const onRetry = mock(() => {});
      render(<BlockedBanner tasks={[task]} stepsMap={{ "task-1": steps }} onRetry={onRetry} />);

      fireEvent.click(screen.getByTestId("retry-button-task-1"));

      expect(screen.getByTestId("retry-step-option-implement")).toBeDefined();
      expect(screen.getByTestId("retry-step-option-full-review")).toBeDefined();
    });

    test("calls onRetry with selected stepId when confirmed", () => {
      const task = makeBlockedTask();
      const steps = [
        makeStep({ stepId: "implement" }),
        makeStep({ id: "step-exec-2", stepId: "full-review", status: "failure" }),
      ];
      const onRetry = mock(() => {});
      render(<BlockedBanner tasks={[task]} stepsMap={{ "task-1": steps }} onRetry={onRetry} />);

      fireEvent.click(screen.getByTestId("retry-button-task-1"));
      fireEvent.click(screen.getByTestId("retry-step-option-full-review"));
      fireEvent.click(screen.getByTestId("retry-dialog-confirm"));

      expect(onRetry).toHaveBeenCalledWith(task, "full-review");
    });

    test("deduplicates steps with the same stepId", () => {
      const task = makeBlockedTask();
      const steps = [
        makeStep({ stepId: "implement" }),
        makeStep({ id: "step-exec-2", stepId: "implement" }),
        makeStep({ id: "step-exec-3", stepId: "full-review" }),
      ];
      const onRetry = mock(() => {});
      render(<BlockedBanner tasks={[task]} stepsMap={{ "task-1": steps }} onRetry={onRetry} />);

      fireEvent.click(screen.getByTestId("retry-button-task-1"));

      expect(screen.getByTestId("retry-step-option-implement")).toBeDefined();
      expect(screen.getByTestId("retry-step-option-full-review")).toBeDefined();
    });

    test("closes dialog on cancel", () => {
      const task = makeBlockedTask();
      const steps = [makeStep({ stepId: "implement" })];
      const onRetry = mock(() => {});
      render(<BlockedBanner tasks={[task]} stepsMap={{ "task-1": steps }} onRetry={onRetry} />);

      fireEvent.click(screen.getByTestId("retry-button-task-1"));
      expect(screen.getByTestId("retry-step-option-implement")).toBeDefined();

      fireEvent.click(screen.getByTestId("retry-dialog-cancel"));
      expect(onRetry).not.toHaveBeenCalled();
    });

    test("ignores steps without a stepId", () => {
      const task = makeBlockedTask();
      const steps = [
        makeStep({ stepId: undefined }),
        makeStep({ id: "step-exec-2", stepId: "full-review" }),
      ];
      const onRetry = mock(() => {});
      render(<BlockedBanner tasks={[task]} stepsMap={{ "task-1": steps }} onRetry={onRetry} />);

      fireEvent.click(screen.getByTestId("retry-button-task-1"));

      expect(screen.getByTestId("retry-step-option-full-review")).toBeDefined();
      expect(screen.queryByTestId("retry-step-option-undefined")).toBeNull();
    });
  });
});
