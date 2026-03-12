import { describe, expect, test } from "bun:test";

interface AuthorizationRequest {
  url: URL;
  state: string;
  verifier: string;
}

interface LinearOAuth {
  createAuthorizationRequest(): Promise<AuthorizationRequest> | AuthorizationRequest;
  validateCallback(params: {
    code?: string | null;
    error?: string | null;
    errorDescription?: string | null;
    state?: string | null;
  }): { code: string; state: string };
}

interface LinearOAuthModule {
  createLinearOAuth(options: { clientId: string; redirectUri: string }): LinearOAuth;
}

const loadOAuthModule = async (): Promise<LinearOAuthModule> =>
  (await import("./oauth.ts")) as LinearOAuthModule;

describe("integrations/linear/oauth", () => {
  test("creates a Linear authorization URL with PKCE parameters", async () => {
    const { createLinearOAuth } = await loadOAuthModule();
    const oauth = createLinearOAuth({
      clientId: "linear-client-id",
      redirectUri: "http://127.0.0.1:4310/api/linear/callback",
    });

    const request = await oauth.createAuthorizationRequest();

    expect(request.url.origin).toBe("https://linear.app");
    expect(request.url.pathname).toBe("/oauth/authorize");
    expect(request.url.searchParams.get("client_id")).toBe("linear-client-id");
    expect(request.url.searchParams.get("redirect_uri")).toBe(
      "http://127.0.0.1:4310/api/linear/callback",
    );
    expect(request.url.searchParams.get("response_type")).toBe("code");
    expect(request.url.searchParams.get("scope")).toBe("read");
    expect(request.url.searchParams.get("state")).toBe(request.state);
    expect(request.url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(request.url.searchParams.get("code_challenge")).toBeString();
    expect(request.verifier.length).toBeGreaterThan(40);
    expect(request.state.length).toBeGreaterThan(20);
  });

  test("accepts a valid callback and returns the authorization code", async () => {
    const { createLinearOAuth } = await loadOAuthModule();
    const oauth = createLinearOAuth({
      clientId: "linear-client-id",
      redirectUri: "http://127.0.0.1:4310/api/linear/callback",
    });

    const request = await oauth.createAuthorizationRequest();
    const result = oauth.validateCallback({
      code: "oauth-code",
      state: request.state,
    });

    expect(result).toEqual({
      code: "oauth-code",
      state: request.state,
    });
  });

  test("rejects callbacks with the wrong state", async () => {
    const { createLinearOAuth } = await loadOAuthModule();
    const oauth = createLinearOAuth({
      clientId: "linear-client-id",
      redirectUri: "http://127.0.0.1:4310/api/linear/callback",
    });

    await oauth.createAuthorizationRequest();

    expect(() =>
      oauth.validateCallback({
        code: "oauth-code",
        state: "wrong-state",
      }),
    ).toThrow("Invalid Linear OAuth state");
  });

  test("surfaces callback errors from Linear", async () => {
    const { createLinearOAuth } = await loadOAuthModule();
    const oauth = createLinearOAuth({
      clientId: "linear-client-id",
      redirectUri: "http://127.0.0.1:4310/api/linear/callback",
    });

    const request = await oauth.createAuthorizationRequest();

    expect(() =>
      oauth.validateCallback({
        error: "access_denied",
        errorDescription: "The user rejected the request",
        state: request.state,
      }),
    ).toThrow("Linear OAuth error: access_denied");
  });
});
