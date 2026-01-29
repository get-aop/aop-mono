import type { Page } from "@playwright/test";
import type {
  OrchestratorState,
  Subtask,
  SubtaskStatus
} from "../../packages/dashboard/types";
import { createMockSubtask, createMockTask, expect, test } from "./fixtures";

const STATUS_COLORS: Record<SubtaskStatus, { border: string; fill: string }> = {
  PENDING: { border: "rgb(156, 163, 175)", fill: "rgb(255, 255, 255)" },
  INPROGRESS: { border: "rgb(59, 130, 246)", fill: "rgb(219, 234, 254)" },
  AGENT_REVIEW: { border: "rgb(234, 179, 8)", fill: "rgb(254, 249, 195)" },
  PENDING_MERGE: { border: "rgb(234, 179, 8)", fill: "rgb(254, 249, 195)" },
  MERGE_CONFLICT: { border: "rgb(239, 68, 68)", fill: "rgb(254, 226, 226)" },
  BLOCKED: { border: "rgb(239, 68, 68)", fill: "rgb(254, 226, 226)" },
  DONE: { border: "rgb(34, 197, 94)", fill: "rgb(220, 252, 231)" }
};

const createStateWithSubtasks = (subtasks: Subtask[]): OrchestratorState => ({
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

const waitForReactFlow = async (page: Page) => {
  await page.waitForSelector(".react-flow", { timeout: 10000 });
};

test.describe("DAG View", () => {
  test.describe("Node Rendering", () => {
    test("renders React Flow nodes for each subtask", async ({ page }) => {
      const subtasks = [
        createMockSubtask({ number: 1, status: "PENDING", dependencies: [] }),
        createMockSubtask({
          number: 2,
          status: "INPROGRESS",
          dependencies: [1]
        }),
        createMockSubtask({ number: 3, status: "DONE", dependencies: [2] })
      ];
      const state = createStateWithSubtasks(subtasks);
      await setupMockWebSocket(page, state);
      await page.goto("/");

      await selectTask(page);

      const dagView = page.locator(".dag-view");
      await expect(dagView).toBeVisible();
      await waitForReactFlow(page);

      const reactFlow = dagView.locator(".react-flow");
      await expect(reactFlow).toBeVisible();

      const nodes = dagView.locator(".react-flow__node");
      await expect(nodes).toHaveCount(3);

      for (const subtask of subtasks) {
        const node = dagView.locator(`.react-flow__node[data-id="${subtask.filename}"]`);
        await expect(node).toBeVisible();

        await expect(node).toContainText(`#${subtask.number}`);
        await expect(node).toContainText(subtask.frontmatter.title);
      }
    });

    test("renders empty DAG when no subtasks", async ({ page }) => {
      const state = createStateWithSubtasks([]);
      await setupMockWebSocket(page, state);
      await page.goto("/");

      await selectTask(page);

      const dagView = page.locator(".dag-view");
      await expect(dagView).toBeVisible();
      await waitForReactFlow(page);

      const nodes = dagView.locator(".react-flow__node");
      await expect(nodes).toHaveCount(0);
    });
  });

  test.describe("Status Colors", () => {
    const testCases: { status: SubtaskStatus; description: string }[] = [
      { status: "PENDING", description: "gray border, white fill" },
      { status: "INPROGRESS", description: "blue border, light blue fill" },
      { status: "DONE", description: "green border, light green fill" },
      { status: "BLOCKED", description: "red border, light red fill" },
      {
        status: "AGENT_REVIEW",
        description: "yellow border, light yellow fill"
      },
      {
        status: "PENDING_MERGE",
        description: "yellow border, light yellow fill"
      },
      { status: "MERGE_CONFLICT", description: "red border, light red fill" }
    ];

    for (const { status, description } of testCases) {
      test(`${status} status shows ${description}`, async ({ page }) => {
        const subtasks = [
          createMockSubtask({ number: 1, status, dependencies: [] })
        ];
        const state = createStateWithSubtasks(subtasks);
        await setupMockWebSocket(page, state);
        await page.goto("/");

        await selectTask(page);

        const dagView = page.locator(".dag-view");
        await expect(dagView).toBeVisible();
        await waitForReactFlow(page);

        const nodeContent = dagView.locator(".react-flow__node [role='button']").first();
        await expect(nodeContent).toBeVisible();

        const expectedColors = STATUS_COLORS[status];
        await expect(nodeContent).toHaveCSS("border-color", expectedColors.border);
        await expect(nodeContent).toHaveCSS("background-color", expectedColors.fill);
      });
    }

    test("multiple nodes show their respective status colors", async ({
      page
    }) => {
      const statuses: SubtaskStatus[] = ["DONE", "INPROGRESS", "PENDING"];
      const subtasks = statuses.map((status, i) =>
        createMockSubtask({
          number: i + 1,
          status,
          dependencies: i > 0 ? [i] : []
        })
      );
      const state = createStateWithSubtasks(subtasks);
      await setupMockWebSocket(page, state);
      await page.goto("/");

      await selectTask(page);
      await waitForReactFlow(page);

      for (let i = 0; i < statuses.length; i++) {
        const subtask = subtasks[i];
        const nodeSelector = `.react-flow__node[data-id="${subtask.filename}"] [role='button']`;
        const nodeContent = page.locator(nodeSelector);
        await expect(nodeContent).toBeVisible();

        const expected = STATUS_COLORS[statuses[i]];
        await expect(nodeContent).toHaveCSS("border-color", expected.border);
        await expect(nodeContent).toHaveCSS("background-color", expected.fill);
      }
    });
  });

  test.describe("Edge Rendering", () => {
    test("renders edges between dependent nodes", async ({ page }) => {
      const subtasks = [
        createMockSubtask({ number: 1, dependencies: [] }),
        createMockSubtask({ number: 2, dependencies: [1] }),
        createMockSubtask({ number: 3, dependencies: [2] })
      ];
      const state = createStateWithSubtasks(subtasks);
      await setupMockWebSocket(page, state);
      await page.goto("/");

      await selectTask(page);
      await waitForReactFlow(page);

      const dagView = page.locator(".dag-view");
      await expect(dagView).toBeVisible();

      const edges = dagView.locator(".react-flow__edge");
      await expect(edges).toHaveCount(2);
    });

    test("renders no edges when nodes have no dependencies", async ({
      page
    }) => {
      const subtasks = [
        createMockSubtask({ number: 1, dependencies: [] }),
        createMockSubtask({ number: 2, dependencies: [] }),
        createMockSubtask({ number: 3, dependencies: [] })
      ];
      const state = createStateWithSubtasks(subtasks);
      await setupMockWebSocket(page, state);
      await page.goto("/");

      await selectTask(page);
      await waitForReactFlow(page);

      const edges = page.locator(".dag-view .react-flow__edge");
      await expect(edges).toHaveCount(0);
    });

    test("renders multiple edges for multi-dependency nodes", async ({
      page
    }) => {
      const subtasks = [
        createMockSubtask({ number: 1, dependencies: [] }),
        createMockSubtask({ number: 2, dependencies: [] }),
        createMockSubtask({ number: 3, dependencies: [1, 2] })
      ];
      const state = createStateWithSubtasks(subtasks);
      await setupMockWebSocket(page, state);
      await page.goto("/");

      await selectTask(page);
      await waitForReactFlow(page);

      const edges = page.locator(".dag-view .react-flow__edge");
      await expect(edges).toHaveCount(2);
    });

    test("edges have arrow markers", async ({ page }) => {
      const subtasks = [
        createMockSubtask({ number: 1, dependencies: [] }),
        createMockSubtask({ number: 2, dependencies: [1] })
      ];
      const state = createStateWithSubtasks(subtasks);
      await setupMockWebSocket(page, state);
      await page.goto("/");

      await selectTask(page);
      await waitForReactFlow(page);

      const edges = page.locator(".dag-view .react-flow__edge");
      await expect(edges).toHaveCount(1);

      const edgePath = page.locator(".dag-view .react-flow__edge-path").first();
      const markerEnd = await edgePath.getAttribute("marker-end");
      expect(markerEnd).toBeTruthy();
      expect(markerEnd).toContain("url(");
    });
  });

  test.describe("Node Interactions", () => {
    test("nodes have pointer cursor and are interactive", async ({ page }) => {
      const subtasks = [
        createMockSubtask({
          number: 1,
          status: "INPROGRESS",
          dependencies: []
        }),
        createMockSubtask({ number: 2, status: "PENDING", dependencies: [1] })
      ];
      const state = createStateWithSubtasks(subtasks);
      await setupMockWebSocket(page, state);
      await page.goto("/");

      await selectTask(page);
      await waitForReactFlow(page);

      const nodeContent = page.locator(".dag-view .react-flow__node [role='button']").first();
      await expect(nodeContent).toHaveCSS("cursor", "pointer");
    });

    test("nodes are keyboard accessible", async ({ page }) => {
      const subtasks = [
        createMockSubtask({ number: 1, status: "INPROGRESS", dependencies: [] })
      ];
      const state = createStateWithSubtasks(subtasks);
      await setupMockWebSocket(page, state);
      await page.goto("/");

      await selectTask(page);
      await waitForReactFlow(page);

      const nodeContent = page.locator(".dag-view .react-flow__node [role='button']").first();
      await expect(nodeContent).toHaveAttribute("role", "button");
      await expect(nodeContent).toHaveAttribute("tabindex", "0");
    });

    test("blocked nodes show unblock button", async ({ page }) => {
      const subtasks = [
        createMockSubtask({ number: 1, status: "BLOCKED", dependencies: [] })
      ];
      const state = createStateWithSubtasks(subtasks);
      await setupMockWebSocket(page, state);
      await page.goto("/");

      await selectTask(page);
      await waitForReactFlow(page);

      const unblockButton = page.locator(".dag-view .dag-node-unblock");
      await expect(unblockButton).toBeVisible();
      await expect(unblockButton).toHaveText("Unblock");
    });

    test("non-blocked nodes do not show unblock button", async ({ page }) => {
      const subtasks = [
        createMockSubtask({ number: 1, status: "INPROGRESS", dependencies: [] })
      ];
      const state = createStateWithSubtasks(subtasks);
      await setupMockWebSocket(page, state);
      await page.goto("/");

      await selectTask(page);
      await waitForReactFlow(page);

      const unblockButton = page.locator(".dag-view .dag-node-unblock");
      await expect(unblockButton).toHaveCount(0);
    });
  });

  test.describe("Node Positions", () => {
    test("nodes without dependencies appear in first column", async ({
      page
    }) => {
      const subtasks = [
        createMockSubtask({ number: 1, dependencies: [] }),
        createMockSubtask({ number: 2, dependencies: [] })
      ];
      const state = createStateWithSubtasks(subtasks);
      await setupMockWebSocket(page, state);
      await page.goto("/");

      await selectTask(page);
      await waitForReactFlow(page);

      const nodes = page.locator(".dag-view .react-flow__node");
      await expect(nodes).toHaveCount(2);

      const transforms = await nodes.evaluateAll((nodeElements) =>
        nodeElements.map((n) => {
          const style = n.getAttribute("style") || "";
          const transformMatch = style.match(/transform:\s*translate\(([^,]+)px/);
          return transformMatch ? Number.parseFloat(transformMatch[1]) : null;
        })
      );

      for (const x of transforms) {
        expect(x).not.toBeNull();
        expect(x).toBe(0);
      }
    });

    test("dependent nodes appear in subsequent columns", async ({ page }) => {
      const subtasks = [
        createMockSubtask({ number: 1, dependencies: [] }),
        createMockSubtask({ number: 2, dependencies: [1] }),
        createMockSubtask({ number: 3, dependencies: [2] })
      ];
      const state = createStateWithSubtasks(subtasks);
      await setupMockWebSocket(page, state);
      await page.goto("/");

      await selectTask(page);
      await waitForReactFlow(page);

      const getNodeXPosition = async (filename: string) => {
        const node = page.locator(`.dag-view .react-flow__node[data-id="${filename}"]`);
        const style = await node.getAttribute("style");
        const match = style?.match(/transform:\s*translate\(([^,]+)px/);
        return match ? Number.parseFloat(match[1]) : 0;
      };

      const x1 = await getNodeXPosition(subtasks[0].filename);
      const x2 = await getNodeXPosition(subtasks[1].filename);
      const x3 = await getNodeXPosition(subtasks[2].filename);

      expect(x1).toBe(0);
      expect(x2).toBeGreaterThan(x1);
      expect(x3).toBeGreaterThan(x2);
    });

    test("nodes with same dependencies appear in same column", async ({
      page
    }) => {
      const subtasks = [
        createMockSubtask({ number: 1, dependencies: [] }),
        createMockSubtask({ number: 2, dependencies: [1] }),
        createMockSubtask({ number: 3, dependencies: [1] })
      ];
      const state = createStateWithSubtasks(subtasks);
      await setupMockWebSocket(page, state);
      await page.goto("/");

      await selectTask(page);
      await waitForReactFlow(page);

      const getNodeXPosition = async (filename: string) => {
        const node = page.locator(`.dag-view .react-flow__node[data-id="${filename}"]`);
        const style = await node.getAttribute("style");
        const match = style?.match(/transform:\s*translate\(([^,]+)px/);
        return match ? Number.parseFloat(match[1]) : 0;
      };

      const x2 = await getNodeXPosition(subtasks[1].filename);
      const x3 = await getNodeXPosition(subtasks[2].filename);

      expect(x2).toBe(x3);
    });

    test("nodes in same column are stacked vertically", async ({ page }) => {
      const subtasks = [
        createMockSubtask({ number: 1, dependencies: [] }),
        createMockSubtask({ number: 2, dependencies: [] }),
        createMockSubtask({ number: 3, dependencies: [] })
      ];
      const state = createStateWithSubtasks(subtasks);
      await setupMockWebSocket(page, state);
      await page.goto("/");

      await selectTask(page);
      await waitForReactFlow(page);

      const getNodeYPosition = async (filename: string) => {
        const node = page.locator(`.dag-view .react-flow__node[data-id="${filename}"]`);
        const style = await node.getAttribute("style");
        const match = style?.match(/transform:\s*translate\([^,]+px,\s*([^)]+)px\)/);
        return match ? Number.parseFloat(match[1]) : 0;
      };

      const yPositions = await Promise.all(
        subtasks.map((s) => getNodeYPosition(s.filename))
      );

      expect(yPositions[0]).toBe(0);
      expect(yPositions[1]).toBeGreaterThan(yPositions[0]);
      expect(yPositions[2]).toBeGreaterThan(yPositions[1]);
    });

    test("React Flow container is present and has dimensions", async ({ page }) => {
      const subtasks = [
        createMockSubtask({ number: 1, dependencies: [] }),
        createMockSubtask({ number: 2, dependencies: [1] })
      ];
      const state = createStateWithSubtasks(subtasks);
      await setupMockWebSocket(page, state);
      await page.goto("/");

      await selectTask(page);
      await waitForReactFlow(page);

      const reactFlow = page.locator(".dag-view .react-flow");
      await expect(reactFlow).toBeVisible();

      const boundingBox = await reactFlow.boundingBox();
      expect(boundingBox).not.toBeNull();
      expect(boundingBox!.width).toBeGreaterThan(0);
      expect(boundingBox!.height).toBeGreaterThan(0);
    });
  });

  test.describe("Node Selection", () => {
    test("clicking a node highlights it with blue border", async ({ page }) => {
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
      await waitForReactFlow(page);

      const dagView = page.locator(".dag-view");
      await expect(dagView).toBeVisible();

      const firstNodeContent = dagView.locator(`.react-flow__node[data-id="${subtasks[0].filename}"] [role='button']`);

      await expect(firstNodeContent).toHaveCSS("border-color", STATUS_COLORS.PENDING.border);
      await expect(firstNodeContent).toHaveCSS("border-width", "2px");

      await firstNodeContent.click();

      await expect(firstNodeContent).toHaveCSS("border-color", "rgb(59, 130, 246)");
      await expect(firstNodeContent).toHaveCSS("border-width", "3px");
    });

    test("clicking a different node changes selection", async ({ page }) => {
      const subtasks = [
        createMockSubtask({ number: 1, status: "PENDING", dependencies: [] }),
        createMockSubtask({ number: 2, status: "PENDING", dependencies: [1] })
      ];
      const state = createStateWithSubtasks(subtasks);
      await setupMockWebSocket(page, state);
      await page.goto("/");

      await selectTask(page);
      await waitForReactFlow(page);

      const firstNodeContent = page.locator(`.dag-view .react-flow__node[data-id="${subtasks[0].filename}"] [role='button']`);
      const secondNodeContent = page.locator(`.dag-view .react-flow__node[data-id="${subtasks[1].filename}"] [role='button']`);

      await firstNodeContent.click();

      await expect(firstNodeContent).toHaveCSS("border-width", "3px");

      await secondNodeContent.click();

      await expect(firstNodeContent).toHaveCSS("border-width", "2px");
      await expect(secondNodeContent).toHaveCSS("border-width", "3px");
    });

    test("selected node has blue border regardless of status", async ({
      page
    }) => {
      const subtasks = [
        createMockSubtask({ number: 1, status: "DONE", dependencies: [] })
      ];
      const state = createStateWithSubtasks(subtasks);
      await setupMockWebSocket(page, state);
      await page.goto("/");

      await selectTask(page);
      await waitForReactFlow(page);

      const nodeContent = page.locator(`.dag-view .react-flow__node[data-id="${subtasks[0].filename}"] [role='button']`);

      await expect(nodeContent).toHaveCSS("border-color", STATUS_COLORS.DONE.border);

      await nodeContent.click();

      await expect(nodeContent).toHaveCSS("border-color", "rgb(59, 130, 246)");
    });

    test("node is keyboard accessible for selection", async ({ page }) => {
      const subtasks = [
        createMockSubtask({ number: 1, status: "PENDING", dependencies: [] })
      ];
      const state = createStateWithSubtasks(subtasks);
      await setupMockWebSocket(page, state);
      await page.goto("/");

      await selectTask(page);
      await waitForReactFlow(page);

      const nodeContent = page.locator(`.dag-view .react-flow__node[data-id="${subtasks[0].filename}"] [role='button']`);

      await nodeContent.focus();
      await page.keyboard.press("Enter");

      await expect(nodeContent).toHaveCSS("border-width", "3px");
      await expect(nodeContent).toHaveCSS("border-color", "rgb(59, 130, 246)");
    });
  });

  test.describe("Pan and Zoom", () => {
    test("nodes are draggable (nodesDraggable enabled)", async ({ page }) => {
      const subtasks = [
        createMockSubtask({ number: 1, status: "PENDING", dependencies: [] })
      ];
      const state = createStateWithSubtasks(subtasks);
      await setupMockWebSocket(page, state);
      await page.goto("/");

      await selectTask(page);
      await waitForReactFlow(page);

      const node = page.locator(`.dag-view .react-flow__node[data-id="${subtasks[0].filename}"]`);
      await expect(node).toBeVisible();

      const hasClass = await node.evaluate((el) => el.classList.contains("draggable"));
      expect(hasClass).toBe(true);
    });
  });
});
