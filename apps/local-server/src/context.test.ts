import { describe, expect, test } from "bun:test";
import { resolveLinearCallbackUrl } from "./context.ts";

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
});
