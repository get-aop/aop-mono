import type { Page } from "@playwright/test";
import type { OrchestratorState } from "../../packages/dashboard/types";
import { createMockSubtask, createMockTask, expect, test } from "./fixtures";

const createStateWithSubtasks = (
  subtasks: ReturnType<typeof createMockSubtask>[]
): OrchestratorState => ({
  tasks: [
    createMockTask({
      folder: "test-task",
      title: "Test Task",
      status: "INPROGRESS"
    })
  ],
  plans: {
    "test-task": {
      folder: "test-task",
      frontmatter: {
        status: "INPROGRESS",
        task: "test-task",
        created: new Date("2026-01-01")
      },
      subtasks: subtasks.map((s) => ({
        number: s.number,
        slug: s.slug,
        title: s.frontmatter.title,
        dependencies: s.frontmatter.dependencies
      }))
    }
  },
  subtasks: {
    "test-task": subtasks
  }
});

const setupMockWebSocket = async (page: Page, state: OrchestratorState) => {
  await page.routeWebSocket("ws://localhost:3001/api/events", (ws) => {
    ws.onMessage(() => {});
    setTimeout(() => {
      ws.send(JSON.stringify({ type: "state", data: state }));
    }, 50);
  });
};

const selectTask = async (page: Page) => {
  const taskCard = page.locator(".task-card").first();
  await expect(taskCard).toBeVisible({ timeout: 10000 });
  await taskCard.click();
};

const createLargeDAG = () => [
  createMockSubtask({ number: 1, status: "PENDING", dependencies: [] }),
  createMockSubtask({ number: 2, status: "INPROGRESS", dependencies: [1] }),
  createMockSubtask({ number: 3, status: "DONE", dependencies: [1] }),
  createMockSubtask({ number: 4, status: "PENDING", dependencies: [2, 3] }),
  createMockSubtask({ number: 5, status: "BLOCKED", dependencies: [4] }),
  createMockSubtask({ number: 6, status: "AGENT_REVIEW", dependencies: [4] }),
  createMockSubtask({
    number: 7,
    status: "PENDING_MERGE",
    dependencies: [5, 6]
  })
];

test.describe("DAG Navigation Controls", () => {
  test.describe("Controls Panel", () => {
    test("renders controls panel with zoom buttons", async ({ page }) => {
      const subtasks = [
        createMockSubtask({ number: 1, status: "PENDING", dependencies: [] }),
        createMockSubtask({
          number: 2,
          status: "INPROGRESS",
          dependencies: [1]
        })
      ];
      const state = createStateWithSubtasks(subtasks);
      await setupMockWebSocket(page, state);
      await page.goto("/");

      await selectTask(page);

      const controls = page.locator('[data-testid="rf__controls"]');
      await expect(controls).toBeVisible();

      const zoomIn = page.locator('button[aria-label="Zoom In"]');
      await expect(zoomIn).toBeVisible();

      const zoomOut = page.locator('button[aria-label="Zoom Out"]');
      await expect(zoomOut).toBeVisible();

      const fitView = page.locator('button[aria-label="Fit View"]');
      await expect(fitView).toBeVisible();
    });

    test("zoom in button increases zoom level", async ({ page }) => {
      const state = createStateWithSubtasks(createLargeDAG());
      await setupMockWebSocket(page, state);
      await page.goto("/");

      await selectTask(page);

      const viewport = page.locator(".react-flow__viewport");
      await expect(viewport).toBeVisible();

      const zoomOut = page.locator('button[aria-label="Zoom Out"]');
      await zoomOut.click();
      await zoomOut.click();
      await page.waitForTimeout(300);

      const initialTransform = await viewport.getAttribute("style");
      const initialScale = initialTransform?.match(/scale\(([\d.]+)\)/)?.[1];

      const zoomIn = page.locator('button[aria-label="Zoom In"]');
      await zoomIn.click();

      await page.waitForTimeout(300);

      const newTransform = await viewport.getAttribute("style");
      const newScale = newTransform?.match(/scale\(([\d.]+)\)/)?.[1];

      expect(Number(newScale)).toBeGreaterThan(Number(initialScale));
    });

    test("zoom out button decreases zoom level", async ({ page }) => {
      const state = createStateWithSubtasks(createLargeDAG());
      await setupMockWebSocket(page, state);
      await page.goto("/");

      await selectTask(page);

      const viewport = page.locator(".react-flow__viewport");
      await expect(viewport).toBeVisible();

      const initialTransform = await viewport.getAttribute("style");
      const initialScale = initialTransform?.match(/scale\(([\d.]+)\)/)?.[1];

      const zoomOut = page.locator('button[aria-label="Zoom Out"]');
      await zoomOut.click();
      await page.waitForTimeout(300);

      const newTransform = await viewport.getAttribute("style");
      const newScale = newTransform?.match(/scale\(([\d.]+)\)/)?.[1];

      expect(Number(newScale)).toBeLessThan(Number(initialScale));
    });

    test("fit view button adjusts view to show all nodes", async ({ page }) => {
      const state = createStateWithSubtasks(createLargeDAG());
      await setupMockWebSocket(page, state);
      await page.goto("/");

      await selectTask(page);

      const viewport = page.locator(".react-flow__viewport");
      await expect(viewport).toBeVisible();

      const zoomIn = page.locator('button[aria-label="Zoom In"]');
      await zoomIn.click();
      await zoomIn.click();
      await page.waitForTimeout(300);

      const zoomedTransform = await viewport.getAttribute("style");

      const fitView = page.locator('button[aria-label="Fit View"]');
      await fitView.click();
      await page.waitForTimeout(300);

      const fitTransform = await viewport.getAttribute("style");
      expect(fitTransform).not.toBe(zoomedTransform);
    });

    test("controls are positioned at bottom-left", async ({ page }) => {
      const subtasks = [
        createMockSubtask({ number: 1, status: "PENDING", dependencies: [] })
      ];
      const state = createStateWithSubtasks(subtasks);
      await setupMockWebSocket(page, state);
      await page.goto("/");

      await selectTask(page);

      const controls = page.locator('[data-testid="rf__controls"]');
      await expect(controls).toBeVisible();

      const controlsClasses = await controls.getAttribute("class");
      expect(controlsClasses).toContain("bottom");
      expect(controlsClasses).toContain("left");
    });
  });

  test.describe("MiniMap", () => {
    test("renders minimap panel", async ({ page }) => {
      const subtasks = [
        createMockSubtask({ number: 1, status: "PENDING", dependencies: [] }),
        createMockSubtask({
          number: 2,
          status: "INPROGRESS",
          dependencies: [1]
        })
      ];
      const state = createStateWithSubtasks(subtasks);
      await setupMockWebSocket(page, state);
      await page.goto("/");

      await selectTask(page);

      const minimap = page.locator('[data-testid="rf__minimap"]');
      await expect(minimap).toBeVisible();
    });

    test("minimap is positioned at bottom-right", async ({ page }) => {
      const subtasks = [
        createMockSubtask({ number: 1, status: "PENDING", dependencies: [] })
      ];
      const state = createStateWithSubtasks(subtasks);
      await setupMockWebSocket(page, state);
      await page.goto("/");

      await selectTask(page);

      const minimap = page.locator('[data-testid="rf__minimap"]');
      await expect(minimap).toBeVisible();

      const minimapClasses = await minimap.getAttribute("class");
      expect(minimapClasses).toContain("bottom");
      expect(minimapClasses).toContain("right");
    });

    test("minimap contains SVG element", async ({ page }) => {
      const subtasks = [
        createMockSubtask({ number: 1, status: "PENDING", dependencies: [] }),
        createMockSubtask({
          number: 2,
          status: "INPROGRESS",
          dependencies: [1]
        })
      ];
      const state = createStateWithSubtasks(subtasks);
      await setupMockWebSocket(page, state);
      await page.goto("/");

      await selectTask(page);

      const minimapSvg = page.locator('[data-testid="rf__minimap"] svg');
      await expect(minimapSvg).toBeVisible();
      await expect(minimapSvg).toHaveClass(/react-flow__minimap-svg/);
    });
  });

  test.describe("Background", () => {
    test("renders dots background pattern", async ({ page }) => {
      const subtasks = [
        createMockSubtask({ number: 1, status: "PENDING", dependencies: [] })
      ];
      const state = createStateWithSubtasks(subtasks);
      await setupMockWebSocket(page, state);
      await page.goto("/");

      await selectTask(page);

      const background = page.locator('[data-testid="rf__background"]');
      await expect(background).toBeVisible();
    });

    test("background has dots pattern class", async ({ page }) => {
      const subtasks = [
        createMockSubtask({ number: 1, status: "PENDING", dependencies: [] })
      ];
      const state = createStateWithSubtasks(subtasks);
      await setupMockWebSocket(page, state);
      await page.goto("/");

      await selectTask(page);

      const dotsPattern = page.locator(".react-flow__background-pattern.dots");
      await expect(dotsPattern).toHaveCount(1);
    });
  });

  test.describe("Pan and Zoom Interactions", () => {
    test("mouse wheel changes zoom level", async ({ page }) => {
      const state = createStateWithSubtasks(createLargeDAG());
      await setupMockWebSocket(page, state);
      await page.goto("/");

      await selectTask(page);

      const dagView = page.locator(".dag-view");
      await expect(dagView).toBeVisible();

      const zoomOut = page.locator('button[aria-label="Zoom Out"]');
      await zoomOut.click();
      await zoomOut.click();
      await page.waitForTimeout(300);

      const viewport = page.locator(".react-flow__viewport");
      const initialTransform = await viewport.getAttribute("style");
      const initialScale =
        Number(initialTransform?.match(/scale\(([\d.]+)\)/)?.[1]) || 1;

      await dagView.hover();
      await page.mouse.wheel(0, -100);
      await page.waitForTimeout(300);

      const newTransform = await viewport.getAttribute("style");
      const newScale =
        Number(newTransform?.match(/scale\(([\d.]+)\)/)?.[1]) || 1;

      expect(newScale).toBeGreaterThan(initialScale);
    });

    test("dragging pane changes viewport position", async ({ page }) => {
      const state = createStateWithSubtasks(createLargeDAG());
      await setupMockWebSocket(page, state);
      await page.goto("/");

      await selectTask(page);

      const pane = page.locator(".react-flow__pane");
      await expect(pane).toBeVisible();

      const viewport = page.locator(".react-flow__viewport");
      const initialTransform = await viewport.getAttribute("style");

      const box = await pane.boundingBox();
      if (box) {
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(
          box.x + box.width / 2 + 100,
          box.y + box.height / 2 + 50
        );
        await page.mouse.up();
      }
      await page.waitForTimeout(300);

      const newTransform = await viewport.getAttribute("style");
      expect(newTransform).not.toBe(initialTransform);
    });
  });
});
