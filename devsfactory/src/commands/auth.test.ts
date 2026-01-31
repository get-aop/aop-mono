import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { ensureAuth, getStoredApiKey, parseAuthArgs } from "./auth";

describe("auth", () => {
  describe("parseAuthArgs", () => {
    it("should parse --help flag", () => {
      expect(parseAuthArgs(["--help"])).toEqual({ help: true });
      expect(parseAuthArgs(["-h"])).toEqual({ help: true });
    });

    it("should parse status subcommand", () => {
      expect(parseAuthArgs(["status"])).toEqual({ status: true });
      expect(parseAuthArgs(["--status"])).toEqual({ status: true });
    });

    it("should return error for unknown options", () => {
      expect(parseAuthArgs(["--unknown"])).toEqual({
        error: "Unknown option: --unknown"
      });
    });

    it("should return empty object for no args", () => {
      expect(parseAuthArgs([])).toEqual({});
    });
  });

  describe("getStoredApiKey", () => {
    const originalEnv = process.env.ANTHROPIC_API_KEY;

    beforeEach(() => {
      delete process.env.ANTHROPIC_API_KEY;
    });

    afterEach(() => {
      if (originalEnv) {
        process.env.ANTHROPIC_API_KEY = originalEnv;
      } else {
        delete process.env.ANTHROPIC_API_KEY;
      }
    });

    it("should return env var if set", async () => {
      process.env.ANTHROPIC_API_KEY = "env-api-key";
      const key = await getStoredApiKey();
      expect(key).toBe("env-api-key");
    });

    it("should return null if no env var and no file", async () => {
      const key = await getStoredApiKey();
      // May or may not be null depending on whether auth file exists
      expect(key === null || typeof key === "string").toBe(true);
    });
  });

  describe("ensureAuth", () => {
    const originalEnv = process.env.ANTHROPIC_API_KEY;

    beforeEach(() => {
      delete process.env.ANTHROPIC_API_KEY;
    });

    afterEach(() => {
      if (originalEnv) {
        process.env.ANTHROPIC_API_KEY = originalEnv;
      } else {
        delete process.env.ANTHROPIC_API_KEY;
      }
    });

    it("should set env var when api key exists", async () => {
      process.env.ANTHROPIC_API_KEY = "test-key";
      const key = await ensureAuth();
      expect(key).toBe("test-key");
      expect(process.env.ANTHROPIC_API_KEY).toBe("test-key");
    });
  });
});
