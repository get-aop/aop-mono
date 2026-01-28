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

test.describe("DAG View", () => {
  test.describe("Node Rendering", () => {
    test("renders SVG nodes for each subtask", async ({ page }) => {
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

      const svg = dagView.locator("svg");
      await expect(svg).toHaveAttribute("role", "img");
      await expect(svg).toHaveAttribute(
        "aria-label",
        "Subtask dependency graph"
      );

      const nodeGroups = svg.locator("g[role='button']");
      await expect(nodeGroups).toHaveCount(3);

      for (const subtask of subtasks) {
        const nodeNumber = svg.locator(`text:has-text("#${subtask.number}")`);
        await expect(nodeNumber).toBeVisible();

        const nodeTitle = svg.locator(
          `text:has-text("${subtask.frontmatter.title}")`
        );
        await expect(nodeTitle).toBeVisible();
      }
    });

    test("renders empty DAG when no subtasks", async ({ page }) => {
      const state = createStateWithSubtasks([]);
      await setupMockWebSocket(page, state);
      await page.goto("/");

      await selectTask(page);

      const dagView = page.locator(".dag-view");
      await expect(dagView).toBeVisible();

      const svg = dagView.locator("svg");
      await expect(svg).toBeVisible();

      const nodeGroups = svg.locator("g[role='button']");
      await expect(nodeGroups).toHaveCount(0);
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

        const nodeRect = dagView.locator("svg g[role='button'] rect").first();
        await expect(nodeRect).toBeVisible();

        const expectedColors = STATUS_COLORS[status];
        await expect(nodeRect).toHaveCSS("stroke", expectedColors.border);
        await expect(nodeRect).toHaveCSS("fill", expectedColors.fill);
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

      const nodeRects = page.locator(".dag-view svg g[role='button'] rect");
      await expect(nodeRects).toHaveCount(3);

      for (let i = 0; i < statuses.length; i++) {
        const rect = nodeRects.nth(i);
        const expected = STATUS_COLORS[statuses[i]];
        await expect(rect).toHaveCSS("stroke", expected.border);
        await expect(rect).toHaveCSS("fill", expected.fill);
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

      const dagView = page.locator(".dag-view");
      await expect(dagView).toBeVisible();

      const edges = dagView.locator("svg path[stroke='#9ca3af']");
      await expect(edges).toHaveCount(2);

      for (let i = 0; i < 2; i++) {
        const edge = edges.nth(i);
        await expect(edge).toHaveAttribute("fill", "none");
        await expect(edge).toHaveAttribute("stroke-width", "2");
        await expect(edge).toHaveAttribute("marker-end", "url(#arrowhead)");

        const d = await edge.getAttribute("d");
        expect(d).toMatch(/^M \d+ \d+ Q \d+ \d+ \d+ \d+$/);
      }
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

      const edges = page.locator(".dag-view svg path[stroke='#9ca3af']");
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

      const edges = page.locator(".dag-view svg path[stroke='#9ca3af']");
      await expect(edges).toHaveCount(2);
    });

    test("renders arrowhead marker definition", async ({ page }) => {
      const subtasks = [
        createMockSubtask({ number: 1, dependencies: [] }),
        createMockSubtask({ number: 2, dependencies: [1] })
      ];
      const state = createStateWithSubtasks(subtasks);
      await setupMockWebSocket(page, state);
      await page.goto("/");

      await selectTask(page);

      const marker = page.locator(".dag-view svg defs marker#arrowhead");
      await expect(marker).toHaveCount(1);
      await expect(marker).toHaveAttribute("orient", "auto");

      const polygon = marker.locator("polygon");
      await expect(polygon).toHaveAttribute("fill", "#9ca3af");
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

      const nodeGroup = page.locator(".dag-view svg g[role='button']").first();
      await expect(nodeGroup).toHaveCSS("cursor", "pointer");
      await expect(nodeGroup).toHaveAttribute("style", /cursor:\s*pointer/);
    });

    test("nodes are keyboard accessible", async ({ page }) => {
      const subtasks = [
        createMockSubtask({ number: 1, status: "INPROGRESS", dependencies: [] })
      ];
      const state = createStateWithSubtasks(subtasks);
      await setupMockWebSocket(page, state);
      await page.goto("/");

      await selectTask(page);

      const nodeGroup = page.locator(".dag-view svg g[role='button']").first();
      await expect(nodeGroup).toHaveAttribute("role", "button");
      await expect(nodeGroup).toHaveAttribute("tabindex", "0");
    });

    test("blocked nodes show unblock button", async ({ page }) => {
      const subtasks = [
        createMockSubtask({ number: 1, status: "BLOCKED", dependencies: [] })
      ];
      const state = createStateWithSubtasks(subtasks);
      await setupMockWebSocket(page, state);
      await page.goto("/");

      await selectTask(page);

      const unblockButton = page.locator(".dag-view svg .dag-node-unblock");
      await expect(unblockButton).toBeVisible();

      const unblockText = unblockButton.locator("text");
      await expect(unblockText).toHaveText("Unblock");
    });

    test("non-blocked nodes do not show unblock button", async ({ page }) => {
      const subtasks = [
        createMockSubtask({ number: 1, status: "INPROGRESS", dependencies: [] })
      ];
      const state = createStateWithSubtasks(subtasks);
      await setupMockWebSocket(page, state);
      await page.goto("/");

      await selectTask(page);

      const unblockButton = page.locator(".dag-view svg .dag-node-unblock");
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

      const nodeGroups = page.locator(".dag-view svg g[role='button']");
      await expect(nodeGroups).toHaveCount(2);

      const transforms = await nodeGroups.evaluateAll((nodes) =>
        nodes.map((n) => n.getAttribute("transform"))
      );

      for (const transform of transforms) {
        const match = transform?.match(/translate\((\d+),\s*(\d+)\)/);
        expect(match).not.toBeNull();
        const x = Number.parseInt(match![1], 10);
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

      const nodeGroups = page.locator(".dag-view svg g[role='button']");
      await expect(nodeGroups).toHaveCount(3);

      const transforms = await nodeGroups.evaluateAll((nodes) =>
        nodes.map((n) => n.getAttribute("transform"))
      );

      const xPositions = transforms.map((t) => {
        const match = t?.match(/translate\((\d+),\s*(\d+)\)/);
        return match ? Number.parseInt(match[1], 10) : 0;
      });

      expect(xPositions[0]).toBe(0);
      expect(xPositions[1]).toBeGreaterThan(xPositions[0]);
      expect(xPositions[2]).toBeGreaterThan(xPositions[1]);
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

      const nodeGroups = page.locator(".dag-view svg g[role='button']");
      const transforms = await nodeGroups.evaluateAll((nodes) =>
        nodes.map((n) => n.getAttribute("transform"))
      );

      const getX = (t: string | null) => {
        const match = t?.match(/translate\((\d+),\s*(\d+)\)/);
        return match ? Number.parseInt(match[1], 10) : 0;
      };

      const x2 = getX(transforms[1]);
      const x3 = getX(transforms[2]);
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

      const nodeGroups = page.locator(".dag-view svg g[role='button']");
      const transforms = await nodeGroups.evaluateAll((nodes) =>
        nodes.map((n) => n.getAttribute("transform"))
      );

      const getY = (t: string | null) => {
        const match = t?.match(/translate\((\d+),\s*(\d+)\)/);
        return match ? Number.parseInt(match[2], 10) : 0;
      };

      const yPositions = transforms.map(getY);

      expect(yPositions[0]).toBe(0);
      expect(yPositions[1]).toBeGreaterThan(yPositions[0]);
      expect(yPositions[2]).toBeGreaterThan(yPositions[1]);
    });

    test("viewBox adapts to DAG dimensions", async ({ page }) => {
      const subtasks = [
        createMockSubtask({ number: 1, dependencies: [] }),
        createMockSubtask({ number: 2, dependencies: [1] })
      ];
      const state = createStateWithSubtasks(subtasks);
      await setupMockWebSocket(page, state);
      await page.goto("/");

      await selectTask(page);

      const svg = page.locator(".dag-view svg");
      const viewBox = await svg.getAttribute("viewBox");

      expect(viewBox).toMatch(/^-\d+ -\d+ \d+ \d+$/);

      const [, , width, height] = viewBox!.split(" ").map(Number);
      expect(width).toBeGreaterThan(0);
      expect(height).toBeGreaterThan(0);
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

      const dagView = page.locator(".dag-view");
      await expect(dagView).toBeVisible();

      const firstNode = dagView.locator("svg g[role='button']").first();
      const firstRect = firstNode.locator("rect").first();

      await expect(firstRect).toHaveCSS("stroke", STATUS_COLORS.PENDING.border);
      await expect(firstRect).toHaveAttribute("stroke-width", "2");

      await firstNode.click();

      await expect(firstRect).toHaveCSS("stroke", "rgb(59, 130, 246)");
      await expect(firstRect).toHaveAttribute("stroke-width", "3");
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

      const nodeGroups = page.locator(".dag-view svg g[role='button']");
      const firstNode = nodeGroups.first();
      const secondNode = nodeGroups.nth(1);

      await firstNode.click();

      const firstRect = firstNode.locator("rect").first();
      await expect(firstRect).toHaveAttribute("stroke-width", "3");

      await secondNode.click();

      await expect(firstRect).toHaveAttribute("stroke-width", "2");

      const secondRect = secondNode.locator("rect").first();
      await expect(secondRect).toHaveAttribute("stroke-width", "3");
    });

    test("selected node has blue stroke regardless of status", async ({
      page
    }) => {
      const subtasks = [
        createMockSubtask({ number: 1, status: "DONE", dependencies: [] })
      ];
      const state = createStateWithSubtasks(subtasks);
      await setupMockWebSocket(page, state);
      await page.goto("/");

      await selectTask(page);

      const node = page.locator(".dag-view svg g[role='button']").first();
      const rect = node.locator("rect").first();

      await expect(rect).toHaveCSS("stroke", STATUS_COLORS.DONE.border);

      await node.click();

      await expect(rect).toHaveCSS("stroke", "rgb(59, 130, 246)");
    });

    test("node is keyboard accessible for selection", async ({ page }) => {
      const subtasks = [
        createMockSubtask({ number: 1, status: "PENDING", dependencies: [] })
      ];
      const state = createStateWithSubtasks(subtasks);
      await setupMockWebSocket(page, state);
      await page.goto("/");

      await selectTask(page);

      const node = page.locator(".dag-view svg g[role='button']").first();
      const rect = node.locator("rect").first();

      await node.focus();
      await page.keyboard.press("Enter");

      await expect(rect).toHaveAttribute("stroke-width", "3");
      await expect(rect).toHaveCSS("stroke", "rgb(59, 130, 246)");
    });
  });
});
