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
});
