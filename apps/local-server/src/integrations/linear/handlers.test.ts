import { describe, expect, mock, test } from "bun:test";

import { createLinearOAuth } from "./oauth.ts";
import { createLinearHandlers, LinearHandlersError } from "./handlers.ts";

describe("integrations/linear/handlers", () => {
  test("uses the current saved config to build the authorization URL", async () => {
    const getConfig = mock(async () => ({
      enabled: true,
      clientId: "linear-client-id",
      redirectUri: "http://127.0.0.1:4310/api/linear/callback",
    }));

    const handlers = createLinearHandlers({
      createAuth: createLinearOAuth,
      getConfig,
      tokenStore: {
        save: async () => {},
        getStatus: async () => ({ connected: false, locked: false }),
        unlock: async () => {},
        read: async () => ({
          accessToken: "token",
          refreshToken: "refresh",
          expiresAt: new Date().toISOString(),
        }),
        lock: async () => {},
        disconnect: async () => {},
      },
      exchangeCodeForTokens: async () => ({
        accessToken: "token",
        refreshToken: "refresh",
        expiresAt: new Date().toISOString(),
      }),
      testConnectionWithToken: async () => ({
        ok: true,
        organizationName: "Acme",
        userName: "Jane Doe",
        userEmail: "jane@example.com",
      }),
    });

    const result = await handlers.connect();
    const authorizeUrl = new URL(result.authorizeUrl);

    expect(getConfig).toHaveBeenCalledTimes(1);
    expect(authorizeUrl.searchParams.get("client_id")).toBe("linear-client-id");
    expect(authorizeUrl.searchParams.get("redirect_uri")).toBe(
      "http://127.0.0.1:4310/api/linear/callback",
    );
  });

  test("keeps the original connect config for the callback exchange", async () => {
    let currentConfig = {
      enabled: true,
      clientId: "linear-client-id-a",
      redirectUri: "http://127.0.0.1:4310/api/linear/callback",
    };

    const exchangeCodeForTokens = mock(async () => ({
      accessToken: "token",
      refreshToken: "refresh",
      expiresAt: new Date().toISOString(),
    }));
    const save = mock(async () => {});

    const handlers = createLinearHandlers({
      createAuth: createLinearOAuth,
      getConfig: async () => currentConfig,
      tokenStore: {
        save,
        getStatus: async () => ({ connected: false, locked: false }),
        unlock: async () => {},
        read: async () => ({
          accessToken: "token",
          refreshToken: "refresh",
          expiresAt: new Date().toISOString(),
        }),
        lock: async () => {},
        disconnect: async () => {},
      },
      exchangeCodeForTokens,
      testConnectionWithToken: async () => ({
        ok: true,
        organizationName: "Acme",
        userName: "Jane Doe",
        userEmail: "jane@example.com",
      }),
    });

    const connectResult = await handlers.connect();
    const authorizeUrl = new URL(connectResult.authorizeUrl);
    const state = authorizeUrl.searchParams.get("state");
    expect(state).toBeTruthy();

    currentConfig = {
      enabled: true,
      clientId: "linear-client-id-b",
      redirectUri: "http://127.0.0.1:9999/api/linear/callback",
    };

    const callbackResult = await handlers.callback({
      code: "oauth-code",
      state,
    });

    expect(callbackResult).toEqual({ connected: true });
    expect(exchangeCodeForTokens).toHaveBeenCalledTimes(1);
    expect(exchangeCodeForTokens).toHaveBeenCalledWith({
      clientId: "linear-client-id-a",
      code: "oauth-code",
      redirectUri: "http://127.0.0.1:4310/api/linear/callback",
      verifier: expect.any(String),
    });
    expect(save).toHaveBeenCalledTimes(1);
  });

  test("returns a helpful configuration error when Linear OAuth is not configured", async () => {
    const handlers = createLinearHandlers({
      createAuth: createLinearOAuth,
      getConfig: async () => ({
        enabled: false,
        clientId: "",
        redirectUri: "",
      }),
      tokenStore: {
        save: async () => {},
        getStatus: async () => ({ connected: false, locked: false }),
        unlock: async () => {},
        read: async () => ({
          accessToken: "token",
          refreshToken: "refresh",
          expiresAt: new Date().toISOString(),
        }),
        lock: async () => {},
        disconnect: async () => {},
      },
      exchangeCodeForTokens: async () => ({
        accessToken: "token",
        refreshToken: "refresh",
        expiresAt: new Date().toISOString(),
      }),
      testConnectionWithToken: async () => ({
        ok: true,
        organizationName: "Acme",
        userName: "Jane Doe",
        userEmail: "jane@example.com",
      }),
    });

    await expect(handlers.connect()).rejects.toEqual(
      new LinearHandlersError(
        503,
        "Linear OAuth is not configured. Set linear_client_id and linear_callback_url in Settings or via the CLI.",
      ),
    );
  });
});
