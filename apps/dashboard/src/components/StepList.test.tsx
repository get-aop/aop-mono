import { describe, expect, test } from "bun:test";
import type { ReactElement } from "react";
import type { Step } from "../types";
import type { LogLine } from "./LogViewer";
import { filterLogsByStep, StepList } from "./StepList";

const renderToString = async (component: ReactElement): Promise<string> => {
  const { renderToStaticMarkup } = await import("react-dom/server");
  return renderToStaticMarkup(component);
};

describe("StepList", () => {
  describe("empty state", () => {
    test("renders no steps message when steps array is empty", async () => {
      const html = await renderToString(<StepList steps={[]} />);
      expect(html).toContain("No steps recorded");
    });
  });

  describe("step rendering", () => {
    test("renders step type badge with formatted type", async () => {
      const steps: Step[] = [
        {
          id: "step-1",
          stepType: "implement",
          status: "success",
          startedAt: "2024-01-01T00:00:00.000Z",
          endedAt: "2024-01-01T00:05:00.000Z",
        },
      ];

      const html = await renderToString(<StepList steps={steps} />);
      expect(html).toContain("implement");
      expect(html).toContain("step-list");
    });

    test("formats step type with hyphens and underscores", async () => {
      const steps: Step[] = [
        {
          id: "step-1",
          stepType: "quick-review",
          status: "success",
          startedAt: "2024-01-01T00:00:00.000Z",
          endedAt: "2024-01-01T00:05:00.000Z",
        },
      ];

      const html = await renderToString(<StepList steps={steps} />);
      expect(html).toContain("quick review");
    });

    test("prefers stepId over stepType for badge label", async () => {
      const steps: Step[] = [
        {
          id: "step-1",
          stepId: "codebase_research",
          stepType: "research",
          status: "success",
          startedAt: "2024-01-01T00:00:00.000Z",
          endedAt: "2024-01-01T00:05:00.000Z",
        },
      ];

      const html = await renderToString(<StepList steps={steps} />);
      expect(html).toContain("codebase research");
      expect(html).not.toContain(">research<");
    });

    test("falls back to stepType when stepId is absent", async () => {
      const steps: Step[] = [
        {
          id: "step-1",
          stepType: "iterate",
          status: "success",
          startedAt: "2024-01-01T00:00:00.000Z",
          endedAt: "2024-01-01T00:05:00.000Z",
        },
      ];

      const html = await renderToString(<StepList steps={steps} />);
      expect(html).toContain("iterate");
    });

    test("shows unknown for null step type", async () => {
      const steps: Step[] = [
        {
          id: "step-1",
          stepType: null,
          status: "success",
          startedAt: "2024-01-01T00:00:00.000Z",
          endedAt: "2024-01-01T00:05:00.000Z",
        },
      ];

      const html = await renderToString(<StepList steps={steps} />);
      expect(html).toContain("unknown");
    });
  });

  describe("status rendering", () => {
    test("renders success status", async () => {
      const steps: Step[] = [
        {
          id: "step-1",
          stepType: "implement",
          status: "success",
          startedAt: "2024-01-01T00:00:00.000Z",
          endedAt: "2024-01-01T00:05:00.000Z",
        },
      ];

      const html = await renderToString(<StepList steps={steps} />);
      expect(html).toContain("success");
      expect(html).toContain("text-aop-success");
    });

    test("renders failure status", async () => {
      const steps: Step[] = [
        {
          id: "step-1",
          stepType: "implement",
          status: "failure",
          startedAt: "2024-01-01T00:00:00.000Z",
          endedAt: "2024-01-01T00:05:00.000Z",
        },
      ];

      const html = await renderToString(<StepList steps={steps} />);
      expect(html).toContain("failed");
      expect(html).toContain("text-aop-blocked");
    });

    test("renders running status", async () => {
      const steps: Step[] = [
        {
          id: "step-1",
          stepType: "implement",
          status: "running",
          startedAt: "2024-01-01T00:00:00.000Z",
        },
      ];

      const html = await renderToString(<StepList steps={steps} />);
      expect(html).toContain("running");
      expect(html).toContain("text-aop-working");
    });

    test("renders cancelled status", async () => {
      const steps: Step[] = [
        {
          id: "step-1",
          stepType: "implement",
          status: "cancelled",
          startedAt: "2024-01-01T00:00:00.000Z",
          endedAt: "2024-01-01T00:05:00.000Z",
        },
      ];

      const html = await renderToString(<StepList steps={steps} />);
      expect(html).toContain("cancelled");
    });
  });

  describe("duration display", () => {
    test("shows running indicator for running steps", async () => {
      const steps: Step[] = [
        {
          id: "step-1",
          stepType: "implement",
          status: "running",
          startedAt: "2024-01-01T00:00:00.000Z",
        },
      ];

      const html = await renderToString(<StepList steps={steps} />);
      expect(html).toContain("running...");
    });

    test("shows duration for completed steps", async () => {
      const steps: Step[] = [
        {
          id: "step-1",
          stepType: "implement",
          status: "success",
          startedAt: "2024-01-01T00:00:00.000Z",
          endedAt: "2024-01-01T00:05:00.000Z",
        },
      ];

      const html = await renderToString(<StepList steps={steps} />);
      expect(html).toContain("5m 0s");
    });
  });

  describe("error display", () => {
    test("shows error message when present", async () => {
      const steps: Step[] = [
        {
          id: "step-1",
          stepType: "implement",
          status: "failure",
          startedAt: "2024-01-01T00:00:00.000Z",
          endedAt: "2024-01-01T00:05:00.000Z",
          error: "Build failed: syntax error",
        },
      ];

      const html = await renderToString(<StepList steps={steps} />);
      expect(html).toContain("Build failed: syntax error");
    });
  });

  describe("multiple steps", () => {
    test("renders all steps", async () => {
      const steps: Step[] = [
        {
          id: "step-1",
          stepType: "implement",
          status: "success",
          startedAt: "2024-01-01T00:00:00.000Z",
          endedAt: "2024-01-01T00:05:00.000Z",
        },
        {
          id: "step-2",
          stepType: "review",
          status: "running",
          startedAt: "2024-01-01T00:05:00.000Z",
        },
      ];

      const html = await renderToString(<StepList steps={steps} />);
      expect(html).toContain("implement");
      expect(html).toContain("review");
      expect(html).toContain("step-item-step-1");
      expect(html).toContain("step-item-step-2");
    });
  });

  describe("step selection", () => {
    const steps: Step[] = [
      {
        id: "step-1",
        stepType: "implement",
        status: "success",
        startedAt: "2024-01-01T00:00:00.000Z",
        endedAt: "2024-01-01T00:05:00.000Z",
      },
      {
        id: "step-2",
        stepType: "review",
        status: "success",
        startedAt: "2024-01-01T00:05:00.000Z",
        endedAt: "2024-01-01T00:10:00.000Z",
      },
    ];

    const noop = () => {};

    test("renders chevron indicators when onStepClick is provided", async () => {
      const html = await renderToString(
        <StepList steps={steps} selectedStepId={null} onStepClick={noop} />,
      );
      expect(html).toContain("▶");
      expect(html).not.toContain("▼");
    });

    test("selected step shows down chevron", async () => {
      const html = await renderToString(
        <StepList steps={steps} selectedStepId="step-1" onStepClick={noop} />,
      );
      expect(html).toContain("▼");
    });

    test("selected step has highlight background", async () => {
      const html = await renderToString(
        <StepList steps={steps} selectedStepId="step-1" onStepClick={noop} />,
      );
      expect(html).toContain("bg-aop-charcoal/30");
    });

    test("no chevron indicators without onStepClick", async () => {
      const html = await renderToString(<StepList steps={steps} />);
      expect(html).not.toContain("▶");
      expect(html).not.toContain("▼");
    });

    test("renders button element when clickable", async () => {
      const html = await renderToString(
        <StepList steps={steps} selectedStepId={null} onStepClick={noop} />,
      );
      expect(html).toContain("<button");
    });

    test("renders div element when not clickable", async () => {
      const html = await renderToString(<StepList steps={steps} />);
      expect(html).not.toContain("<button");
    });

    test("does not render inline log viewer", async () => {
      const html = await renderToString(
        <StepList steps={steps} selectedStepId="step-1" onStepClick={noop} />,
      );
      expect(html).not.toContain("step-logs-");
      expect(html).not.toContain("log-viewer");
    });
  });
});

describe("filterLogsByStep", () => {
  const logs: LogLine[] = [
    { type: "stdout", content: "before", timestamp: "2024-01-01T00:00:00.000Z" },
    { type: "stdout", content: "during-1", timestamp: "2024-01-01T00:02:00.000Z" },
    { type: "stderr", content: "during-2", timestamp: "2024-01-01T00:04:00.000Z" },
    { type: "stdout", content: "after", timestamp: "2024-01-01T00:06:00.000Z" },
    { type: "stdout", content: "much-later", timestamp: "2024-01-01T00:10:00.000Z" },
  ];

  test("returns logs within step time range", () => {
    const step: Step = {
      id: "s1",
      stepType: "implement",
      status: "success",
      startedAt: "2024-01-01T00:01:00.000Z",
      endedAt: "2024-01-01T00:05:00.000Z",
    };

    const result = filterLogsByStep(logs, step);
    expect(result.map((l) => l.content)).toEqual(["during-1", "during-2"]);
  });

  test("excludes logs outside step time range", () => {
    const step: Step = {
      id: "s1",
      stepType: "implement",
      status: "success",
      startedAt: "2024-01-01T00:01:00.000Z",
      endedAt: "2024-01-01T00:03:00.000Z",
    };

    const result = filterLogsByStep(logs, step);
    expect(result.map((l) => l.content)).toEqual(["during-1"]);
  });

  test("includes all logs from startedAt onward when endedAt is undefined", () => {
    const step: Step = {
      id: "s1",
      stepType: "review",
      status: "running",
      startedAt: "2024-01-01T00:05:00.000Z",
    };

    const result = filterLogsByStep(logs, step);
    expect(result.map((l) => l.content)).toEqual(["after", "much-later"]);
  });

  test("returns empty array for empty logs", () => {
    const step: Step = {
      id: "s1",
      stepType: "implement",
      status: "success",
      startedAt: "2024-01-01T00:00:00.000Z",
      endedAt: "2024-01-01T00:05:00.000Z",
    };

    expect(filterLogsByStep([], step)).toEqual([]);
  });

  test("includes logs on exact boundary timestamps", () => {
    const step: Step = {
      id: "s1",
      stepType: "implement",
      status: "success",
      startedAt: "2024-01-01T00:00:00.000Z",
      endedAt: "2024-01-01T00:04:00.000Z",
    };

    const result = filterLogsByStep(logs, step);
    expect(result.map((l) => l.content)).toEqual(["before", "during-1", "during-2"]);
  });
});
