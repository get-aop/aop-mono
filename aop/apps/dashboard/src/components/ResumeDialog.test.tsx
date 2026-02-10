import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";

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

const { render, screen, cleanup, fireEvent, waitFor } = await import("@testing-library/react");
const { ResumeDialog } = await import("./ResumeDialog");

// Stub HTMLDialogElement methods not available in happy-dom
HTMLDialogElement.prototype.showModal ??= function () {
  this.setAttribute("open", "");
};
HTMLDialogElement.prototype.close ??= function () {
  this.removeAttribute("open");
};

const mockFetch = mock(() => Promise.resolve(new Response()));

const jsonResponse = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });

beforeEach(() => {
  globalThis.fetch = mockFetch as unknown as typeof fetch;
});

afterEach(() => {
  cleanup();
  mockFetch.mockReset();
});

describe("ResumeDialog - input mode", () => {
  test("renders input mode when signal is REQUIRES_INPUT", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        pauseContext: "INPUT_REASON: Need API key\nINPUT_TYPE: text",
        signal: "REQUIRES_INPUT",
      }),
    );

    const onConfirm = mock(() => Promise.resolve());
    const onCancel = mock(() => {});

    render(
      <ResumeDialog
        open={true}
        repoId="repo-1"
        taskId="task-1"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Resume Task")).toBeDefined();
    });

    expect(screen.getByTestId("resume-input")).toBeDefined();
    expect(screen.getByTestId("resume-confirm")).toBeDefined();
    expect(screen.getByText("Resume")).toBeDefined();
  });

  test("renders input mode when signal is null", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ pauseContext: null, signal: null }));

    const onConfirm = mock(() => Promise.resolve());
    const onCancel = mock(() => {});

    render(
      <ResumeDialog
        open={true}
        repoId="repo-1"
        taskId="task-1"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Resume Task")).toBeDefined();
    });

    expect(screen.getByTestId("resume-confirm")).toBeDefined();
  });
});

describe("ResumeDialog - review mode", () => {
  beforeEach(() => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        pauseContext: "## Implementation Plan\n- Step 1\n- Step 2",
        signal: "PLAN_READY",
      }),
    );
  });

  test("renders review mode when signal is PLAN_READY", async () => {
    const onConfirm = mock(() => Promise.resolve());
    const onCancel = mock(() => {});

    render(
      <ResumeDialog
        open={true}
        repoId="repo-1"
        taskId="task-1"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Review")).toBeDefined();
    });

    expect(screen.getByTestId("approve")).toBeDefined();
    expect(screen.getByTestId("request-changes")).toBeDefined();
  });

  test("shows pause context in review mode", async () => {
    const onConfirm = mock(() => Promise.resolve());
    const onCancel = mock(() => {});

    render(
      <ResumeDialog
        open={true}
        repoId="repo-1"
        taskId="task-1"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("pause-context")).toBeDefined();
    });

    expect(screen.getByTestId("pause-context").textContent).toContain("Implementation Plan");
  });

  test("approve button calls onConfirm with approval message", async () => {
    const onConfirm = mock(() => Promise.resolve());
    const onCancel = mock(() => {});

    render(
      <ResumeDialog
        open={true}
        repoId="repo-1"
        taskId="task-1"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("approve")).toBeDefined();
    });

    fireEvent.click(screen.getByTestId("approve"));

    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledWith("Approved. Proceed with the plan.");
    });
  });

  test("request changes reveals textarea", async () => {
    const onConfirm = mock(() => Promise.resolve());
    const onCancel = mock(() => {});

    render(
      <ResumeDialog
        open={true}
        repoId="repo-1"
        taskId="task-1"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("request-changes")).toBeDefined();
    });

    fireEvent.click(screen.getByTestId("request-changes"));

    await waitFor(() => {
      expect(screen.getByTestId("resume-input")).toBeDefined();
      expect(screen.getByTestId("submit-feedback")).toBeDefined();
    });
  });

  test("request changes submit calls onConfirm with feedback", async () => {
    const onConfirm = mock(() => Promise.resolve());
    const onCancel = mock(() => {});

    render(
      <ResumeDialog
        open={true}
        repoId="repo-1"
        taskId="task-1"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("request-changes")).toBeDefined();
    });

    fireEvent.click(screen.getByTestId("request-changes"));

    await waitFor(() => {
      expect(screen.getByTestId("resume-input")).toBeDefined();
    });

    fireEvent.change(screen.getByTestId("resume-input"), {
      target: { value: "Change X and Y" },
    });

    fireEvent.click(screen.getByTestId("submit-feedback"));

    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledWith("Change X and Y");
    });
  });

  test("does not show textarea initially in review mode", async () => {
    const onConfirm = mock(() => Promise.resolve());
    const onCancel = mock(() => {});

    render(
      <ResumeDialog
        open={true}
        repoId="repo-1"
        taskId="task-1"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("approve")).toBeDefined();
    });

    expect(screen.queryByTestId("resume-input")).toBeNull();
  });
});
