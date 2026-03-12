import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  exchangeLinearCodeForTokens,
  resolveLinearCallbackUrl,
  testLinearConnection,
} from "./context.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("resolveLinearCallbackUrl", () => {
  test("replaces the legacy source-install callback with the current local server callback", () => {
    expect(
      resolveLinearCallbackUrl({
        configuredCallbackUrl: "http://127.0.0.1:4310/api/linear/callback",
        env: {
          AOP_LOCAL_SERVER_URL: "http://127.0.0.1:25150",
        } as NodeJS.ProcessEnv,
      }),
    ).toBe("http://127.0.0.1:25150/api/linear/callback");
  });

  test("keeps an explicitly configured callback that does not match the legacy source-install url", () => {
    expect(
      resolveLinearCallbackUrl({
        configuredCallbackUrl: "http://127.0.0.1:9999/api/linear/callback",
        env: {
          AOP_LOCAL_SERVER_URL: "http://127.0.0.1:25150",
        } as NodeJS.ProcessEnv,
      }),
    ).toBe("http://127.0.0.1:9999/api/linear/callback");
  });

  test("posts the token exchange as urlencoded form data", async () => {
    const fetchMock = mock(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            access_token: "access-token",
            refresh_token: "refresh-token",
            expires_in: 3600,
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
            },
          },
        ),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    await exchangeLinearCodeForTokens({
      clientId: "linear-client-id",
      code: "oauth-code",
      verifier: "pkce-verifier",
      redirectUri: "http://127.0.0.1:25150/api/linear/callback",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.linear.app/oauth/token",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/x-www-form-urlencoded",
        }),
        body: new URLSearchParams({
          client_id: "linear-client-id",
          code: "oauth-code",
          code_verifier: "pkce-verifier",
          grant_type: "authorization_code",
          redirect_uri: "http://127.0.0.1:25150/api/linear/callback",
        }).toString(),
      }),
    );
  });

  test("sends bearer auth when validating the Linear connection", async () => {
    const fetchMock = mock(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            data: {
              viewer: {
                name: "Jane Doe",
                email: "jane@example.com",
                organization: {
                  name: "Acme",
                },
              },
            },
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
            },
          },
        ),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    await testLinearConnection("access-token");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.linear.app/graphql",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer access-token",
        }),
      }),
    );
  });
});
