import { describe, expect, test } from "bun:test";
import { Hono } from "hono";

interface LinearRoutesModule {
  createLinearRoutes(deps: {
    handlers: {
      connect(): Promise<{ authorizeUrl: string }> | { authorizeUrl: string };
      callback(params: {
        code?: string | null;
        error?: string | null;
        errorDescription?: string | null;
        state?: string | null;
      }): Promise<{ connected: boolean }> | { connected: boolean };
      getStatus():
        | Promise<{ connected: boolean; locked: boolean }>
        | {
            connected: boolean;
            locked: boolean;
          };
      unlock(): Promise<void>;
      disconnect(): Promise<void>;
      testConnection(): Promise<{
        ok: boolean;
        organizationName: string;
        userName: string;
        userEmail: string;
      }>;
    };
    importFromInput?(params: { cwd: string; input: string }): Promise<{
      repoId: string;
      alreadyExists: boolean;
      imported: Array<{
        taskId: string;
        ref: string;
        changePath: string;
        requested: boolean;
        dependencyImported: boolean;
      }>;
      failures: Array<{
        ref: string;
        error: string;
      }>;
    }>;
    getImportOptions?(): Promise<{
      projects: Array<{
        id: string;
        name: string;
      }>;
      users: Array<{
        id: string;
        name: string;
        displayName: string | null;
        email: string | null;
        isMe: boolean;
      }>;
    }>;
    getTodoIssues?(params: { projectId: string; assigneeId?: string }): Promise<{
      issues: Array<{
        id: string;
        identifier: string;
        title: string;
        url: string;
        projectName: string | null;
        assigneeName: string | null;
        stateName: string | null;
      }>;
    }>;
  }): Hono;
}

const loadRoutesModule = async (): Promise<LinearRoutesModule> =>
  (await import("./routes.ts")) as LinearRoutesModule;

describe("integrations/linear/routes", () => {
  test("POST /connect returns an authorization URL", async () => {
    const { createLinearRoutes } = await loadRoutesModule();
    const app = new Hono();
    let connectCalls = 0;

    app.route(
      "/api/linear",
      createLinearRoutes({
        handlers: {
          connect: () => {
            connectCalls += 1;
            return {
              authorizeUrl:
                "https://linear.app/oauth/authorize?client_id=linear-client-id&response_type=code",
            };
          },
          callback: async () => ({ connected: true }),
          getStatus: async () => ({ connected: true, locked: true }),
          unlock: async () => {},
          disconnect: async () => {},
          testConnection: async () => ({
            ok: true,
            organizationName: "Acme",
            userName: "Jane Doe",
            userEmail: "jane@example.com",
          }),
        },
      }),
    );

    const res = await app.request("/api/linear/connect", {
      method: "POST",
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(connectCalls).toBe(1);
    expect(body).toEqual({
      authorizeUrl:
        "https://linear.app/oauth/authorize?client_id=linear-client-id&response_type=code",
    });
  });

  test("GET /callback exchanges and persists tokens", async () => {
    const { createLinearRoutes } = await loadRoutesModule();
    const app = new Hono();
    let callbackParams:
      | {
          code?: string | null;
          error?: string | null;
          errorDescription?: string | null;
          state?: string | null;
        }
      | undefined;

    app.route(
      "/api/linear",
      createLinearRoutes({
        handlers: {
          connect: () => ({ authorizeUrl: "https://linear.app/oauth/authorize" }),
          callback: async (params) => {
            callbackParams = params;
            return { connected: true };
          },
          getStatus: async () => ({ connected: true, locked: true }),
          unlock: async () => {},
          disconnect: async () => {},
          testConnection: async () => ({
            ok: true,
            organizationName: "Acme",
            userName: "Jane Doe",
            userEmail: "jane@example.com",
          }),
        },
      }),
    );

    const res = await app.request("/api/linear/callback?code=oauth-code&state=state-123");
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(callbackParams).toEqual({
      code: "oauth-code",
      error: null,
      errorDescription: null,
      state: "state-123",
    });
    expect(body).toEqual({
      connected: true,
    });
  });

  test("GET /callback returns a completion page for browser requests", async () => {
    const { createLinearRoutes } = await loadRoutesModule();
    const app = new Hono();

    app.route(
      "/api/linear",
      createLinearRoutes({
        handlers: {
          connect: () => ({ authorizeUrl: "https://linear.app/oauth/authorize" }),
          callback: async () => ({ connected: true }),
          getStatus: async () => ({ connected: true, locked: true }),
          unlock: async () => {},
          disconnect: async () => {},
          testConnection: async () => ({
            ok: true,
            organizationName: "Acme",
            userName: "Jane Doe",
            userEmail: "jane@example.com",
          }),
        },
      }),
    );

    const res = await app.request("/api/linear/callback?code=oauth-code&state=state-123", {
      headers: {
        Accept: "text/html",
      },
    });
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(body).toContain("Linear connected");
    expect(body).toContain("BroadcastChannel");
    expect(body).toContain("aop-linear-oauth");
    expect(body).toContain("window.close()");
  });

  test("GET /status returns token-store status", async () => {
    const { createLinearRoutes } = await loadRoutesModule();
    const app = new Hono();

    app.route(
      "/api/linear",
      createLinearRoutes({
        handlers: {
          connect: () => ({ authorizeUrl: "https://linear.app/oauth/authorize" }),
          callback: async () => ({ connected: true }),
          getStatus: async () => ({ connected: true, locked: true }),
          unlock: async () => {},
          disconnect: async () => {},
          testConnection: async () => ({
            ok: true,
            organizationName: "Acme",
            userName: "Jane Doe",
            userEmail: "jane@example.com",
          }),
        },
      }),
    );

    const res = await app.request("/api/linear/status");
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      connected: true,
      locked: true,
    });
  });

  test("POST /unlock and POST /disconnect forward to the handlers", async () => {
    const { createLinearRoutes } = await loadRoutesModule();
    const app = new Hono();
    const seen = {
      unlocks: 0,
      disconnected: false,
    };

    app.route(
      "/api/linear",
      createLinearRoutes({
        handlers: {
          connect: () => ({ authorizeUrl: "https://linear.app/oauth/authorize" }),
          callback: async () => ({ connected: true }),
          getStatus: async () => ({ connected: true, locked: true }),
          unlock: async () => {
            seen.unlocks += 1;
          },
          disconnect: async () => {
            seen.disconnected = true;
          },
          testConnection: async () => ({
            ok: true,
            organizationName: "Acme",
            userName: "Jane Doe",
            userEmail: "jane@example.com",
          }),
        },
      }),
    );

    const unlockRes = await app.request("/api/linear/unlock", {
      method: "POST",
    });
    const disconnectRes = await app.request("/api/linear/disconnect", { method: "POST" });

    expect(unlockRes.status).toBe(200);
    expect(disconnectRes.status).toBe(200);
    expect(seen).toEqual({
      unlocks: 1,
      disconnected: true,
    });
  });

  test("POST /test-connection returns current Linear identity metadata", async () => {
    const { createLinearRoutes } = await loadRoutesModule();
    const app = new Hono();

    app.route(
      "/api/linear",
      createLinearRoutes({
        handlers: {
          connect: () => ({ authorizeUrl: "https://linear.app/oauth/authorize" }),
          callback: async () => ({ connected: true }),
          getStatus: async () => ({ connected: true, locked: false }),
          unlock: async () => {},
          disconnect: async () => {},
          testConnection: async () => ({
            ok: true,
            organizationName: "Acme",
            userName: "Jane Doe",
            userEmail: "jane@example.com",
          }),
        },
      }),
    );

    const res = await app.request("/api/linear/test-connection", { method: "POST" });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      ok: true,
      organizationName: "Acme",
      userName: "Jane Doe",
      userEmail: "jane@example.com",
    });
  });

  test("POST /import auto-registers a repo and imports Linear issues from the current cwd", async () => {
    const { createLinearRoutes } = await loadRoutesModule();
    const app = new Hono();
    let seenParams: { cwd: string; input: string } | undefined;

    app.route(
      "/api/linear",
      createLinearRoutes({
        handlers: {
          connect: () => ({ authorizeUrl: "https://linear.app/oauth/authorize" }),
          callback: async () => ({ connected: true }),
          getStatus: async () => ({ connected: true, locked: false }),
          unlock: async () => {},
          disconnect: async () => {},
          testConnection: async () => ({
            ok: true,
            organizationName: "Acme",
            userName: "Jane Doe",
            userEmail: "jane@example.com",
          }),
        },
        importFromInput: async (params) => {
          seenParams = params;
          return {
            repoId: "repo_123",
            alreadyExists: false,
            imported: [
              {
                taskId: "task_123",
                ref: "GET-41",
                changePath: "docs/tasks/get-41-dashboard-scroll",
                requested: true,
                dependencyImported: false,
              },
            ],
            failures: [],
          };
        },
      }),
    );

    const res = await app.request("/api/linear/import", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        cwd: "/repo/path",
        input: "GET-41",
      }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(seenParams).toEqual({
      cwd: "/repo/path",
      input: "GET-41",
    });
    expect(body).toEqual({
      ok: true,
      repoId: "repo_123",
      alreadyExists: false,
      imported: [
        {
          taskId: "task_123",
          ref: "GET-41",
          changePath: "docs/tasks/get-41-dashboard-scroll",
          requested: true,
          dependencyImported: false,
        },
      ],
      failures: [],
    });
  });

  test("GET /import-options returns projects and users for the dashboard flow", async () => {
    const { createLinearRoutes } = await loadRoutesModule();
    const app = new Hono();

    app.route(
      "/api/linear",
      createLinearRoutes({
        handlers: {
          connect: () => ({ authorizeUrl: "https://linear.app/oauth/authorize" }),
          callback: async () => ({ connected: true }),
          getStatus: async () => ({ connected: true, locked: false }),
          unlock: async () => {},
          disconnect: async () => {},
          testConnection: async () => ({
            ok: true,
            organizationName: "Acme",
            userName: "Jane Doe",
            userEmail: "jane@example.com",
          }),
        },
        getImportOptions: async () => ({
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
        }),
      }),
    );

    const res = await app.request("/api/linear/import-options");
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
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
  });

  test("GET /todo-issues requires a project and forwards an optional assignee filter", async () => {
    const { createLinearRoutes } = await loadRoutesModule();
    const app = new Hono();
    let seenParams: { projectId: string; assigneeId?: string } | undefined;

    app.route(
      "/api/linear",
      createLinearRoutes({
        handlers: {
          connect: () => ({ authorizeUrl: "https://linear.app/oauth/authorize" }),
          callback: async () => ({ connected: true }),
          getStatus: async () => ({ connected: true, locked: false }),
          unlock: async () => {},
          disconnect: async () => {},
          testConnection: async () => ({
            ok: true,
            organizationName: "Acme",
            userName: "Jane Doe",
            userEmail: "jane@example.com",
          }),
        },
        getTodoIssues: async (params) => {
          seenParams = params;
          return {
            issues: [
              {
                id: "lin_125",
                identifier: "ABC-125",
                title: "Unstarted issue",
                url: "https://linear.app/acme/issue/ABC-125/unstarted-issue",
                projectName: "Dashboard",
                assigneeName: "Jane Doe",
                stateName: "Todo",
              },
            ],
          };
        },
      }),
    );

    const missingProjectRes = await app.request("/api/linear/todo-issues");
    expect(missingProjectRes.status).toBe(400);
    await expect(missingProjectRes.json()).resolves.toEqual({
      error: "Missing required query parameter: projectId",
    });

    const res = await app.request("/api/linear/todo-issues?projectId=project-1&assigneeId=user-1");
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(seenParams).toEqual({ projectId: "project-1", assigneeId: "user-1" });
    expect(body).toEqual({
      issues: [
        {
          id: "lin_125",
          identifier: "ABC-125",
          title: "Unstarted issue",
          url: "https://linear.app/acme/issue/ABC-125/unstarted-issue",
          projectName: "Dashboard",
          assigneeName: "Jane Doe",
          stateName: "Todo",
        },
      ],
    });
  });
});
