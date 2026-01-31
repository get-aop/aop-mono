import {
  test,
  expect,
  createMockProjects,
  createMockOrchestratorState,
  mockProjectsApi,
  mockApiResponse,
  type ProjectListItem
} from "./fixtures";

test.describe("Project Switcher", () => {
  test.describe("Global Mode (multiple projects)", () => {
    const mockProjects = createMockProjects(3);

    test.beforeEach(async ({ page }) => {
      await mockProjectsApi(page, mockProjects);
    });

    test("shows project switcher in header when projects exist", async ({
      dashboardPage
    }) => {
      const projectSwitcher = dashboardPage.locator(".project-switcher");
      await expect(projectSwitcher).toBeVisible();
    });

    test("displays current project name", async ({ dashboardPage }) => {
      const currentProject = dashboardPage.locator(".project-switcher-current");
      await expect(currentProject).toBeVisible();
    });

    test("opens dropdown when clicked", async ({ dashboardPage }) => {
      const switcher = dashboardPage.locator(".project-switcher");
      await switcher.click();

      const dropdown = dashboardPage.locator(".project-switcher-dropdown");
      await expect(dropdown).toBeVisible();
    });

    test("shows all registered projects in dropdown", async ({
      dashboardPage
    }) => {
      const switcher = dashboardPage.locator(".project-switcher");
      await switcher.click();

      const projectItems = dashboardPage.locator(".project-switcher-item");
      await expect(projectItems).toHaveCount(mockProjects.length);

      for (const project of mockProjects) {
        const item = dashboardPage.locator(
          `.project-switcher-item[data-project="${project.name}"]`
        );
        await expect(item).toBeVisible();
        await expect(item).toContainText(project.name);
      }
    });

    test("shows task count badge for each project", async ({
      dashboardPage
    }) => {
      const switcher = dashboardPage.locator(".project-switcher");
      await switcher.click();

      for (const project of mockProjects) {
        const badge = dashboardPage.locator(
          `.project-switcher-item[data-project="${project.name}"] .task-count-badge`
        );
        await expect(badge).toContainText(String(project.taskCount));
      }
    });

    test("switches project when item is clicked", async ({ dashboardPage }) => {
      const switcher = dashboardPage.locator(".project-switcher");
      await switcher.click();

      const secondProject = dashboardPage.locator(
        `.project-switcher-item[data-project="${mockProjects[1].name}"]`
      );
      await secondProject.click();

      const currentProject = dashboardPage.locator(".project-switcher-current");
      await expect(currentProject).toContainText(mockProjects[1].name);
    });

    test("closes dropdown after selecting project", async ({
      dashboardPage
    }) => {
      const switcher = dashboardPage.locator(".project-switcher");
      await switcher.click();

      const secondProject = dashboardPage.locator(
        `.project-switcher-item[data-project="${mockProjects[1].name}"]`
      );
      await secondProject.click();

      const dropdown = dashboardPage.locator(".project-switcher-dropdown");
      await expect(dropdown).not.toBeVisible();
    });

    test("highlights currently selected project in dropdown", async ({
      dashboardPage
    }) => {
      const switcher = dashboardPage.locator(".project-switcher");
      await switcher.click();

      const secondProject = dashboardPage.locator(
        `.project-switcher-item[data-project="${mockProjects[1].name}"]`
      );
      await secondProject.click();

      await switcher.click();

      const selectedItem = dashboardPage.locator(
        `.project-switcher-item[data-project="${mockProjects[1].name}"]`
      );
      await expect(selectedItem).toHaveClass(/selected/);
    });

    test("closes dropdown when clicking outside", async ({ dashboardPage }) => {
      const switcher = dashboardPage.locator(".project-switcher");
      await switcher.click();

      const dropdown = dashboardPage.locator(".project-switcher-dropdown");
      await expect(dropdown).toBeVisible();

      await dashboardPage.locator(".main").click();
      await expect(dropdown).not.toBeVisible();
    });

    test("shows 'All Projects' option in dropdown", async ({
      dashboardPage
    }) => {
      const switcher = dashboardPage.locator(".project-switcher");
      await switcher.click();

      const allProjectsOption = dashboardPage.locator(
        ".project-switcher-item.all-projects"
      );
      await expect(allProjectsOption).toBeVisible();
      await expect(allProjectsOption).toContainText("All Projects");
    });
  });

  test.describe("Local Mode (single project)", () => {
    test("hides project switcher when no projects API is configured", async ({
      page
    }) => {
      await mockApiResponse(page, "**/api/projects", { error: "Not configured" }, { status: 500 });
      await mockApiResponse(page, "**/api/**", {});

      await page.addInitScript((stateData) => {
        const OriginalWebSocket = window.WebSocket;
        window.WebSocket = class extends OriginalWebSocket {
          constructor(url: string | URL, protocols?: string | string[]) {
            super(url, protocols);
            setTimeout(() => {
              const mockEvent = new MessageEvent("message", {
                data: JSON.stringify({ type: "state", data: stateData })
              });
              this.dispatchEvent(mockEvent);
            }, 50);
          }
        } as typeof WebSocket;
      }, createMockOrchestratorState());

      await page.goto("/");
      await page.waitForSelector(".layout");

      const projectSwitcher = page.locator(".project-switcher");
      await expect(projectSwitcher).not.toBeVisible();
    });

    test("hides project switcher when only one project exists", async ({
      page
    }) => {
      const singleProject: ProjectListItem[] = [
        {
          name: "single-project",
          path: "/home/user/single-project",
          registered: new Date(),
          taskCount: 5
        }
      ];

      await mockProjectsApi(page, singleProject);
      await mockApiResponse(page, "**/api/**", {});

      await page.addInitScript((stateData) => {
        const OriginalWebSocket = window.WebSocket;
        window.WebSocket = class extends OriginalWebSocket {
          constructor(url: string | URL, protocols?: string | string[]) {
            super(url, protocols);
            setTimeout(() => {
              const mockEvent = new MessageEvent("message", {
                data: JSON.stringify({ type: "state", data: stateData })
              });
              this.dispatchEvent(mockEvent);
            }, 50);
          }
        } as typeof WebSocket;
      }, createMockOrchestratorState());

      await page.goto("/");
      await page.waitForSelector(".layout");

      const projectSwitcher = page.locator(".project-switcher");
      await expect(projectSwitcher).not.toBeVisible();
    });
  });

  test.describe("URL Routing", () => {
    const mockProjects = createMockProjects(3);

    test.beforeEach(async ({ page }) => {
      await mockProjectsApi(page, mockProjects);
    });

    test("updates URL when switching projects", async ({ dashboardPage }) => {
      const switcher = dashboardPage.locator(".project-switcher");
      await switcher.click();

      const secondProject = dashboardPage.locator(
        `.project-switcher-item[data-project="${mockProjects[1].name}"]`
      );
      await secondProject.click();

      await expect(dashboardPage).toHaveURL(
        new RegExp(`/project/${mockProjects[1].name}`)
      );
    });

    test("navigating to /project/:name selects that project", async ({
      page
    }) => {
      await mockProjectsApi(page, mockProjects);
      await mockApiResponse(page, "**/api/**", {});

      await page.addInitScript((stateData) => {
        const OriginalWebSocket = window.WebSocket;
        window.WebSocket = class extends OriginalWebSocket {
          constructor(url: string | URL, protocols?: string | string[]) {
            super(url, protocols);
            setTimeout(() => {
              const mockEvent = new MessageEvent("message", {
                data: JSON.stringify({ type: "state", data: stateData })
              });
              this.dispatchEvent(mockEvent);
            }, 50);
          }
        } as typeof WebSocket;
      }, createMockOrchestratorState());

      await page.goto(`/project/${mockProjects[1].name}`);
      await page.waitForSelector(".layout");

      const currentProject = page.locator(".project-switcher-current");
      await expect(currentProject).toContainText(mockProjects[1].name);
    });

    test("returns to aggregate view when clicking All Projects", async ({
      dashboardPage
    }) => {
      // First select a specific project
      const switcher = dashboardPage.locator(".project-switcher");
      await switcher.click();

      const secondProject = dashboardPage.locator(
        `.project-switcher-item[data-project="${mockProjects[1].name}"]`
      );
      await secondProject.click();

      // Then click All Projects
      await switcher.click();
      const allProjectsOption = dashboardPage.locator(
        ".project-switcher-item.all-projects"
      );
      await allProjectsOption.click();

      await expect(dashboardPage).toHaveURL(/\/$/);
    });
  });

  test.describe("Task List Filtering", () => {
    const mockProjects = createMockProjects(2);

    test.beforeEach(async ({ page }) => {
      await mockProjectsApi(page, mockProjects);
    });

    test("shows tasks only for selected project", async ({ dashboardPage }) => {
      const switcher = dashboardPage.locator(".project-switcher");
      await switcher.click();

      const firstProject = dashboardPage.locator(
        `.project-switcher-item[data-project="${mockProjects[0].name}"]`
      );
      await firstProject.click();

      // Task list should be filtered to only show tasks for the selected project
      const taskCards = dashboardPage.locator(".task-card");
      await expect(taskCards).toHaveCount(mockProjects[0].taskCount);
    });
  });
});
