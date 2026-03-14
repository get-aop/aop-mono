import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { setupDashboardDom } from "../test/setup-dom";

setupDashboardDom();

const mockGetLinearImportOptions = mock();
const mockGetLinearTodoIssues = mock();
const mockImportLinearIssue = mock();
const mockFetchChangeFiles = mock();
const actualClientModule = await import("../api/client");

mock.module("../api/client", () => ({
  ...actualClientModule,
  getLinearImportOptions: mockGetLinearImportOptions,
  getLinearTodoIssues: mockGetLinearTodoIssues,
  importLinearIssue: mockImportLinearIssue,
  fetchChangeFiles: mockFetchChangeFiles,
}));

const { cleanup, fireEvent, render, screen, waitFor } = await import("@testing-library/react");
const { LinearImportPanel } = await import("./LinearImportPanel");

describe("LinearImportPanel", () => {
  beforeEach(() => {
    mockGetLinearImportOptions.mockReset();
    mockGetLinearTodoIssues.mockReset();
    mockImportLinearIssue.mockReset();
    mockFetchChangeFiles.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  test("asks for a repository before allowing an import", async () => {
    render(<LinearImportPanel repo={null} />);

    fireEvent.click(screen.getByRole("button", { name: "Create from Linear" }));

    expect(
      screen.getByText("Select a repository in the header to import a Linear issue."),
    ).toBeDefined();
    expect(mockGetLinearImportOptions).not.toHaveBeenCalled();
  });

  test("filters TODO issues and imports the selected Linear issue", async () => {
    const onRefresh = mock(async () => {});
    mockGetLinearImportOptions.mockResolvedValue({
      projects: [{ id: "project-1", name: "Dashboard" }],
      users: [
        {
          id: "user-1",
          name: "Jane Doe",
          displayName: "Jane",
          email: "jane@example.com",
          isMe: true,
        },
      ],
    });
    mockGetLinearTodoIssues.mockResolvedValue([
      {
        id: "lin_125",
        identifier: "ABC-125",
        title: "Unstarted issue",
        url: "https://linear.app/acme/issue/ABC-125/unstarted-issue",
        projectName: "Dashboard",
        assigneeName: "Jane Doe",
        stateName: "Todo",
      },
    ]);
    mockImportLinearIssue.mockResolvedValue({
      ok: true,
      repoId: "repo-1",
      alreadyExists: true,
      imported: [
        {
          taskId: "task-1",
          ref: "ABC-125",
          changePath: "docs/tasks/abc-125-unstarted-issue",
          requested: true,
          dependencyImported: false,
        },
      ],
      failures: [],
    });
    mockFetchChangeFiles.mockResolvedValue(["task.md", "plan.md", "001-implement.md"]);

    render(
      <LinearImportPanel
        repo={{ id: "repo-1", name: "aop-mono", path: "/repos/aop-mono" }}
        onRefresh={onRefresh}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Create from Linear" }));

    await waitFor(() => expect(mockGetLinearImportOptions).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText("Linear project"), {
      target: { value: "project-1" },
    });
    fireEvent.change(screen.getByLabelText("Linear user"), {
      target: { value: "user-1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Show TODO issues" }));

    await waitFor(() =>
      expect(mockGetLinearTodoIssues).toHaveBeenCalledWith({
        projectId: "project-1",
        assigneeId: "user-1",
      }),
    );

    fireEvent.click(screen.getByLabelText("ABC-125 Unstarted issue"));
    fireEvent.click(screen.getByRole("button", { name: "Import selected issue" }));

    await waitFor(() =>
      expect(mockImportLinearIssue).toHaveBeenCalledWith({
        cwd: "/repos/aop-mono",
        issueIdentifier: "ABC-125",
      }),
    );
    await waitFor(() => expect(mockFetchChangeFiles).toHaveBeenCalledWith("repo-1", "task-1"));
    await waitFor(() => expect(onRefresh).toHaveBeenCalled());
    expect(screen.getByText("Imported ABC-125 into aop-mono.")).toBeDefined();
  });

  test("resets the issue empty state after a successful import closes the panel", async () => {
    const onRefresh = mock(async () => {});
    mockGetLinearImportOptions.mockResolvedValue({
      projects: [{ id: "project-1", name: "Dashboard" }],
      users: [],
    });
    mockGetLinearTodoIssues.mockResolvedValue([
      {
        id: "lin_125",
        identifier: "ABC-125",
        title: "Started issue",
        url: "https://linear.app/acme/issue/ABC-125/started-issue",
        projectName: "Dashboard",
        assigneeName: null,
        stateName: "In Progress",
      },
    ]);
    mockImportLinearIssue.mockResolvedValue({
      ok: true,
      repoId: "repo-1",
      alreadyExists: false,
      imported: [
        {
          taskId: "task-1",
          ref: "ABC-125",
          changePath: "docs/tasks/abc-125-started-issue",
          requested: true,
          dependencyImported: false,
        },
      ],
      failures: [],
    });
    mockFetchChangeFiles.mockResolvedValue(["task.md", "plan.md", "001-implement.md"]);

    render(
      <LinearImportPanel
        repo={{ id: "repo-1", name: "aop-mono", path: "/repos/aop-mono" }}
        onRefresh={onRefresh}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Create from Linear" }));

    await waitFor(() => expect(mockGetLinearImportOptions).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText("Linear project"), {
      target: { value: "project-1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Show TODO issues" }));

    await waitFor(() =>
      expect(mockGetLinearTodoIssues).toHaveBeenCalledWith({
        projectId: "project-1",
        assigneeId: undefined,
      }),
    );

    fireEvent.click(screen.getByLabelText("ABC-125 Started issue"));
    fireEvent.click(screen.getByRole("button", { name: "Import selected issue" }));

    await waitFor(() => expect(mockImportLinearIssue).toHaveBeenCalled());
    await waitFor(() => expect(mockFetchChangeFiles).toHaveBeenCalled());
    await waitFor(() => expect(onRefresh).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: "Create from Linear" }));

    expect(
      screen.getByText("Choose a project, optionally narrow by user, then load the TODO issues."),
    ).toBeDefined();
    expect(
      screen.queryByText("No matching Linear issues found for this project and user filter."),
    ).toBeNull();
  });

  test("shows a distinct empty state after loading matching Linear issues", async () => {
    mockGetLinearImportOptions.mockResolvedValue({
      projects: [{ id: "project-1", name: "Dashboard" }],
      users: [],
    });
    mockGetLinearTodoIssues.mockResolvedValue([]);

    render(
      <LinearImportPanel repo={{ id: "repo-1", name: "aop-mono", path: "/repos/aop-mono" }} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Create from Linear" }));

    await waitFor(() => expect(mockGetLinearImportOptions).toHaveBeenCalled());

    expect(
      screen.getByText("Choose a project, optionally narrow by user, then load the TODO issues."),
    ).toBeDefined();

    fireEvent.change(screen.getByLabelText("Linear project"), {
      target: { value: "project-1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Show TODO issues" }));

    await waitFor(() =>
      expect(mockGetLinearTodoIssues).toHaveBeenCalledWith({
        projectId: "project-1",
        assigneeId: undefined,
      }),
    );

    expect(
      screen.getByText("No matching Linear issues found for this project and user filter."),
    ).toBeDefined();
  });

  test("keeps the panel in a staged loading state until imported task files are ready", async () => {
    const onRefresh = mock(async () => {});
    mockGetLinearImportOptions.mockResolvedValue({
      projects: [{ id: "project-1", name: "Dashboard" }],
      users: [],
    });
    mockGetLinearTodoIssues.mockResolvedValue([
      {
        id: "lin_126",
        identifier: "GET-42",
        title: "Adopt orchestration patterns",
        url: "https://linear.app/acme/issue/GET-42/adopt-orchestration-patterns",
        projectName: "Dashboard",
        assigneeName: null,
        stateName: "Todo",
      },
    ]);
    mockImportLinearIssue.mockResolvedValue({
      ok: true,
      repoId: "repo-1",
      alreadyExists: true,
      imported: [
        {
          taskId: "task-42",
          ref: "GET-42",
          changePath: "docs/tasks/get-42-adopt-orchestration-patterns",
          requested: true,
          dependencyImported: false,
        },
      ],
      failures: [],
    });
    mockFetchChangeFiles
      .mockResolvedValueOnce(["task.md"])
      .mockResolvedValueOnce(["task.md", "plan.md", "001-event-spine.md"]);

    render(
      <LinearImportPanel
        repo={{ id: "repo-1", name: "aop-mono", path: "/repos/aop-mono" }}
        onRefresh={onRefresh}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Create from Linear" }));
    await waitFor(() => expect(mockGetLinearImportOptions).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText("Linear project"), {
      target: { value: "project-1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Show TODO issues" }));

    await waitFor(() => expect(mockGetLinearTodoIssues).toHaveBeenCalled());

    fireEvent.click(screen.getByLabelText("GET-42 Adopt orchestration patterns"));
    fireEvent.click(screen.getByRole("button", { name: "Import selected issue" }));

    await waitFor(() => expect(screen.getByText("Verifying task files...")).toBeDefined());
    expect(screen.getByText("Draft task, plan, and numbered subtasks")).toBeDefined();
    expect(onRefresh).not.toHaveBeenCalled();

    await waitFor(() => expect(mockFetchChangeFiles).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
    expect(screen.getByText("Imported GET-42 into aop-mono.")).toBeDefined();
  });
});
