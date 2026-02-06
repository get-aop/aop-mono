/**
 * Dashboard E2E Tests
 *
 * Prerequisites: `bun dev` must be running before executing this test
 *
 * Tests the full dashboard workflow using Playwright for browser automation:
 * - Happy path: DRAFT → READY → WORKING → DONE
 * - Unhappy path: BLOCKED tasks, REMOVED tasks, ABORTED tasks
 * - Task detail view with execution history and logs
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { AOP_URLS } from "@aop/common";
import { type Browser, chromium, type Page } from "playwright";
import {
  cleanupTestRepos,
  copyFixture,
  createTempRepo,
  isLocalServerRunning,
  runAopCommand,
  setTaskStatus,
  setupE2ETestDir,
  type TempRepoResult,
  triggerServerRefresh,
  waitForTask,
} from "./helpers";
import { checkDevEnvironment } from "./helpers/server";

const E2E_TIMEOUT = 300_000;
const DASHBOARD_URL = AOP_URLS.DASHBOARD;
const SCREENSHOT_DIR = join(import.meta.dir, "../tmp/screenshots");

const waitForElement = async (
  page: Page,
  selector: string,
  options: { timeout?: number; state?: "visible" | "attached" } = {},
): Promise<boolean> => {
  try {
    await page.waitForSelector(selector, {
      timeout: options.timeout ?? 10_000,
      state: options.state ?? "visible",
    });
    return true;
  } catch {
    return false;
  }
};

describe("dashboard E2E tests", () => {
  let browser: Browser;
  let page: Page;
  let repo: TempRepoResult;
  let taskId: string;

  beforeAll(async () => {
    const envCheck = await checkDevEnvironment();
    if (!envCheck.ready) {
      throw new Error(
        `Dev environment not ready: ${envCheck.reason}\n` +
          "Run 'bun dev' in a separate terminal before running E2E tests.",
      );
    }

    const serverRunning = await isLocalServerRunning();
    if (!serverRunning) {
      throw new Error(
        "Local server not running.\n" +
          "Run 'bun dev' in a separate terminal before running E2E tests.",
      );
    }

    await mkdir(SCREENSHOT_DIR, { recursive: true });
    await setupE2ETestDir();

    browser = await chromium.launch({ headless: true });
    page = await browser.newPage();
    page.setDefaultTimeout(30_000);

    repo = await createTempRepo("dashboard-e2e");
  });

  afterAll(async () => {
    if (page) await page.close();
    if (browser) await browser.close();
    if (repo) await repo.cleanup();
    await cleanupTestRepos();
  });

  describe("happy path", () => {
    test(
      "13.1.1 - Create a new test repository with a fixture task",
      async () => {
        await copyFixture("backlog-test", repo.path);
        await Bun.$`git add .`.cwd(repo.path).quiet();
        await Bun.$`git commit -m "Add fixture"`.cwd(repo.path).quiet();

        const { exitCode } = await runAopCommand(["repo:init", repo.path]);
        expect(exitCode).toBe(0);

        await triggerServerRefresh();
        await Bun.sleep(2000);

        const { exitCode: statusExit, stdout } = await runAopCommand([
          "status",
          join(repo.path, "openspec/changes/backlog-test"),
          "--json",
        ]);
        expect(statusExit).toBe(0);

        const task = JSON.parse(stdout);
        expect(task.status).toBe("DRAFT");
        expect(task.id).toStartWith("task_");
        taskId = task.id;
      },
      E2E_TIMEOUT,
    );

    test(
      "13.1.2 - Verify task is in DRAFT column",
      async () => {
        await page.goto(DASHBOARD_URL);
        const columnVisible = await waitForElement(page, '[data-testid="kanban-column-DRAFT"]');
        expect(columnVisible).toBe(true);

        const taskVisible = await waitForElement(
          page,
          `[data-testid="kanban-column-DRAFT"] [data-testid="task-card-${taskId}"]`,
        );
        expect(taskVisible).toBe(true);

        await page.screenshot({
          path: join(SCREENSHOT_DIR, "01-task-in-draft.png"),
          fullPage: true,
        });
      },
      E2E_TIMEOUT,
    );

    test(
      "13.1.3 - Mark task ready using the Dashboard UI",
      async () => {
        const taskCard = page.locator(`[data-testid="task-card-${taskId}"]`);
        await taskCard.click();

        const detailVisible = await waitForElement(page, '[data-testid="task-detail"]');
        expect(detailVisible).toBe(true);

        await page.screenshot({
          path: join(SCREENSHOT_DIR, "02-task-detail-draft.png"),
          fullPage: true,
        });

        const markReadyButton = page.locator('[data-testid="mark-ready-button"]');
        const buttonVisible = await markReadyButton.isVisible();
        expect(buttonVisible).toBe(true);

        await markReadyButton.click();
        await page.waitForTimeout(2000);

        await page.screenshot({
          path: join(SCREENSHOT_DIR, "03-after-mark-ready.png"),
          fullPage: true,
        });
      },
      E2E_TIMEOUT,
    );

    test(
      "13.1.4 - Verify task is in READY or WORKING column (orchestrator picks up quickly)",
      async () => {
        await page.goto(DASHBOARD_URL);

        // Task may be in READY briefly before orchestrator picks it up, or already in WORKING
        const taskInReadyOrWorking = await waitForElement(
          page,
          `[data-testid="kanban-column-READY"] [data-testid="task-card-${taskId}"], [data-testid="kanban-column-WORKING"] [data-testid="task-card-${taskId}"]`,
          { timeout: 10_000 },
        );
        expect(taskInReadyOrWorking).toBe(true);

        await page.screenshot({
          path: join(SCREENSHOT_DIR, "04-task-in-ready-or-working.png"),
          fullPage: true,
        });
      },
      E2E_TIMEOUT,
    );

    test(
      "13.1.5 - Verify task is in WORKING column",
      async () => {
        const taskInWorking = await waitForElement(
          page,
          `[data-testid="kanban-column-WORKING"] [data-testid="task-card-${taskId}"]`,
          { timeout: 60_000 },
        );
        expect(taskInWorking).toBe(true);

        await page.screenshot({
          path: join(SCREENSHOT_DIR, "05-task-in-working.png"),
          fullPage: true,
        });
      },
      E2E_TIMEOUT,
    );

    test(
      "13.1.6 - Verify task is in DONE column",
      async () => {
        const completedTask = await waitForTask(taskId, ["DONE", "BLOCKED"], {
          timeout: 180_000,
          pollInterval: 5000,
        });

        expect(completedTask).not.toBeNull();
        expect(completedTask?.status).toBe("DONE");

        await page.goto(DASHBOARD_URL);
        const columnVisible = await waitForElement(page, '[data-testid="kanban-column-DONE"]');
        expect(columnVisible).toBe(true);

        const taskInDone = await waitForElement(
          page,
          `[data-testid="kanban-column-DONE"] [data-testid="task-card-${taskId}"]`,
          { timeout: 10_000 },
        );
        expect(taskInDone).toBe(true);

        await page.screenshot({
          path: join(SCREENSHOT_DIR, "06-task-in-done.png"),
          fullPage: true,
        });
      },
      E2E_TIMEOUT,
    );

    test(
      "13.1.7 - Drill down into complete task and view execution history and logs",
      async () => {
        const taskCard = page.locator(`[data-testid="task-card-${taskId}"]`);
        await taskCard.click();

        const detailVisible = await waitForElement(page, '[data-testid="task-detail"]');
        expect(detailVisible).toBe(true);

        await page.screenshot({
          path: join(SCREENSHOT_DIR, "07-task-detail-done.png"),
          fullPage: true,
        });

        const statusBadgeText = await page.locator('[data-testid="status-badge"]').textContent();
        expect(statusBadgeText).toContain("DONE");

        const executionHistoryVisible = await waitForElement(
          page,
          '[data-testid="execution-history"]',
        );
        expect(executionHistoryVisible).toBe(true);

        const executionItems = page.locator('[data-testid^="execution-item-"]');
        const count = await executionItems.count();
        expect(count).toBeGreaterThan(0);

        await executionItems.first().click();
        await page.waitForTimeout(1000);

        await page.screenshot({
          path: join(SCREENSHOT_DIR, "08-execution-logs.png"),
          fullPage: true,
        });
      },
      E2E_TIMEOUT,
    );

    test(
      "14.7 - Open DONE task and verify execution log is displayed",
      async () => {
        await page.goto(DASHBOARD_URL);
        await page.waitForTimeout(1000);

        const taskCard = page.locator(`[data-testid="task-card-${taskId}"]`);
        await taskCard.click();

        const detailVisible = await waitForElement(page, '[data-testid="task-detail"]');
        expect(detailVisible).toBe(true);

        const executionItems = page.locator('[data-testid^="execution-item-"]');
        const count = await executionItems.count();
        expect(count).toBeGreaterThan(0);

        await executionItems.first().click();

        // Wait for persisted logs to load via SSE replay
        await page.waitForTimeout(3000);

        const logViewer = page.locator('[data-testid="log-viewer"]');
        const logContent = await logViewer.textContent();
        const hasLogs = logContent && !logContent.includes("Waiting for logs...");
        expect(hasLogs).toBe(true);

        await page.screenshot({
          path: join(SCREENSHOT_DIR, "14-done-task-logs.png"),
          fullPage: true,
        });
      },
      E2E_TIMEOUT,
    );
  });

  describe("repo registration", () => {
    let regRepo: TempRepoResult;

    beforeAll(async () => {
      regRepo = await createTempRepo("dashboard-register-e2e");
    });

    afterAll(async () => {
      if (regRepo) await regRepo.cleanup();
    });

    test(
      "Register repository via dashboard dialog",
      async () => {
        await page.goto(DASHBOARD_URL);
        await page.waitForTimeout(1000);

        // Click the Register Repo button
        const registerButton = page.locator('button:has-text("+ Register Repo")');
        await registerButton.waitFor({ state: "visible", timeout: 10_000 });
        await registerButton.click();

        // Verify dialog opens
        const dialog = page.locator("dialog");
        await dialog.waitFor({ state: "visible", timeout: 5_000 });

        await page.screenshot({
          path: join(SCREENSHOT_DIR, "register-01-dialog-open.png"),
          fullPage: true,
        });

        // Enter the test repo path in the path input
        const pathInput = page.locator('input[placeholder="Enter path..."]');
        await pathInput.fill(regRepo.path);
        await page.locator('button:has-text("Go")').click();
        await page.waitForTimeout(1000);

        await page.screenshot({
          path: join(SCREENSHOT_DIR, "register-02-navigated.png"),
          fullPage: true,
        });

        // Click Select to register the repo
        const selectButton = page.locator('button:has-text("Select")');
        await selectButton.click();
        await page.waitForTimeout(2000);

        await page.screenshot({
          path: join(SCREENSHOT_DIR, "register-03-registered.png"),
          fullPage: true,
        });

        // Verify success message appears
        const successMessage = page.locator("text=Repository registered successfully");
        const messageVisible = await successMessage.isVisible().catch(() => false);

        // Also check for "already registered" message in case repo was already registered
        if (!messageVisible) {
          const alreadyRegisteredMessage = page.locator("text=Repository already registered");
          const alreadyVisible = await alreadyRegisteredMessage.isVisible().catch(() => false);
          expect(alreadyVisible || messageVisible).toBe(true);
        }
      },
      E2E_TIMEOUT,
    );

    test(
      "Register non-git directory shows error",
      async () => {
        await page.goto(DASHBOARD_URL);
        await page.waitForTimeout(1000);

        const registerButton = page.locator('button:has-text("+ Register Repo")');
        await registerButton.click();

        const dialog = page.locator("dialog");
        await dialog.waitFor({ state: "visible", timeout: 5_000 });

        // Enter a non-git path (using /tmp which is not a git repo)
        const pathInput = page.locator('input[placeholder="Enter path..."]');
        await pathInput.fill("/tmp");
        await page.locator('button:has-text("Go")').click();
        await page.waitForTimeout(500);

        await page.locator('button:has-text("Select")').click();
        await page.waitForTimeout(2000);

        await page.screenshot({
          path: join(SCREENSHOT_DIR, "register-04-not-git-repo.png"),
          fullPage: true,
        });

        // Verify error message appears
        const errorMessage = page.locator("text=Not a git repository");
        const errorVisible = await errorMessage.isVisible().catch(() => false);
        expect(errorVisible).toBe(true);
      },
      E2E_TIMEOUT,
    );
  });

  describe("unhappy path", () => {
    let blockedRepo: TempRepoResult;
    let blockedTaskId: string;

    beforeAll(async () => {
      blockedRepo = await createTempRepo("dashboard-blocked-e2e");
    });

    afterAll(async () => {
      if (blockedRepo) await blockedRepo.cleanup();
    });

    test(
      "13.2.1 - Verify task is in BLOCKED banner (create blocked task via API)",
      async () => {
        // Create a task and directly set it to BLOCKED status via test API
        // This tests the dashboard UI for BLOCKED state without relying on agent failure
        await copyFixture("blocked-test", blockedRepo.path);
        await Bun.$`git add .`.cwd(blockedRepo.path).quiet();
        await Bun.$`git commit -m "Add blocked fixture"`.cwd(blockedRepo.path).quiet();

        const { exitCode } = await runAopCommand(["repo:init", blockedRepo.path]);
        expect(exitCode).toBe(0);

        await triggerServerRefresh();
        await Bun.sleep(2000);

        const { exitCode: statusExit, stdout } = await runAopCommand([
          "status",
          join(blockedRepo.path, "openspec/changes/blocked-test"),
          "--json",
        ]);
        expect(statusExit).toBe(0);

        const task = JSON.parse(stdout);
        expect(task.status).toBe("DRAFT");
        blockedTaskId = task.id;

        // Directly set task to BLOCKED status via test-only API endpoint
        const statusSet = await setTaskStatus(blockedTaskId, "BLOCKED");
        expect(statusSet).toBe(true);

        // Verify task is now BLOCKED
        const blockedTask = await waitForTask(blockedTaskId, ["BLOCKED"], {
          timeout: 10_000,
          pollInterval: 1000,
        });
        expect(blockedTask).not.toBeNull();
        expect(blockedTask?.status).toBe("BLOCKED");

        await page.goto(DASHBOARD_URL);
        await page.waitForTimeout(2000);

        const blockedBannerVisible = await waitForElement(page, '[data-testid="blocked-banner"]', {
          timeout: 10_000,
        });
        expect(blockedBannerVisible).toBe(true);

        const blockedTaskVisible = await waitForElement(
          page,
          `[data-testid="blocked-task-${blockedTaskId}"]`,
          { timeout: 5000 },
        );
        expect(blockedTaskVisible).toBe(true);

        await page.screenshot({
          path: join(SCREENSHOT_DIR, "09-task-blocked.png"),
          fullPage: true,
        });
      },
      E2E_TIMEOUT,
    );

    test(
      "13.2.2 - Verify task is REMOVED via Remove button on blocked banner",
      async () => {
        const removeButton = page.locator(`[data-testid="remove-button-${blockedTaskId}"]`);
        const buttonVisible = await removeButton.isVisible();
        expect(buttonVisible).toBe(true);

        await removeButton.click();
        await page.waitForTimeout(2000);

        const removedTask = await waitForTask(blockedTaskId, ["REMOVED"], {
          timeout: 10_000,
          pollInterval: 1000,
        });
        expect(removedTask?.status).toBe("REMOVED");

        await page.goto(DASHBOARD_URL);
        await page.waitForTimeout(1000);

        const blockedTaskGone = await waitForElement(
          page,
          `[data-testid="blocked-task-${blockedTaskId}"]`,
          { timeout: 2000 },
        );
        expect(blockedTaskGone).toBe(false);

        await page.screenshot({
          path: join(SCREENSHOT_DIR, "10-task-removed.png"),
          fullPage: true,
        });
      },
      E2E_TIMEOUT,
    );

    test(
      "13.2.3 - Verify task can be ABORTED while WORKING (force remove)",
      async () => {
        const abortRepo = await createTempRepo("dashboard-abort-e2e");

        try {
          await copyFixture("backlog-test", abortRepo.path);
          await Bun.$`git add .`.cwd(abortRepo.path).quiet();
          await Bun.$`git commit -m "Add fixture for abort test"`.cwd(abortRepo.path).quiet();

          const { exitCode } = await runAopCommand(["repo:init", abortRepo.path]);
          expect(exitCode).toBe(0);

          await triggerServerRefresh();
          await Bun.sleep(2000);

          const { exitCode: statusExit, stdout } = await runAopCommand([
            "status",
            join(abortRepo.path, "openspec/changes/backlog-test"),
            "--json",
          ]);
          expect(statusExit).toBe(0);

          const task = JSON.parse(stdout);
          const abortTaskId = task.id;

          const { exitCode: readyExit } = await runAopCommand(["task:ready", abortTaskId]);
          expect(readyExit).toBe(0);

          const workingTask = await waitForTask(abortTaskId, ["WORKING"], {
            timeout: 60_000,
            pollInterval: 1000,
          });
          expect(workingTask).not.toBeNull();

          await page.goto(DASHBOARD_URL);
          const taskInWorking = await waitForElement(
            page,
            `[data-testid="kanban-column-WORKING"] [data-testid="task-card-${abortTaskId}"]`,
            { timeout: 10_000 },
          );
          expect(taskInWorking).toBe(true);

          await page.screenshot({
            path: join(SCREENSHOT_DIR, "11-task-working-before-abort.png"),
            fullPage: true,
          });

          const taskCard = page.locator(`[data-testid="task-card-${abortTaskId}"]`);
          await taskCard.click();

          const detailVisible = await waitForElement(page, '[data-testid="task-detail"]');
          expect(detailVisible).toBe(true);

          const removeButton = page.locator('[data-testid="remove-task-button"]');
          await removeButton.click();

          const confirmButton = page.locator('[data-testid="confirm-dialog-confirm"]');
          await confirmButton.waitFor({ state: "visible", timeout: 5000 });
          await confirmButton.click();

          await page.waitForTimeout(3000);

          const abortedTask = await waitForTask(abortTaskId, ["REMOVED"], {
            timeout: 30_000,
            pollInterval: 1000,
          });
          expect(abortedTask?.status).toBe("REMOVED");

          await page.screenshot({
            path: join(SCREENSHOT_DIR, "12-task-aborted.png"),
            fullPage: true,
          });
        } finally {
          await abortRepo.cleanup();
        }
      },
      E2E_TIMEOUT,
    );
  });
});
