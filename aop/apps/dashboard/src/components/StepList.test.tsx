import { describe, expect, test } from "bun:test";
import type { ReactElement } from "react";
import type { Step } from "../types";
import { StepList } from "./StepList";

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
});
