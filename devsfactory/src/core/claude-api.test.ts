import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { getAnthropicModel, getApiKey } from "./claude-api";

describe("claude-api", () => {
  describe("getApiKey", () => {
    const originalEnv = process.env.AOP_AUTH_TOKEN;

    beforeEach(() => {
      delete process.env.AOP_AUTH_TOKEN;
    });

    afterEach(() => {
      if (originalEnv) {
        process.env.AOP_AUTH_TOKEN = originalEnv;
      } else {
        delete process.env.AOP_AUTH_TOKEN;
      }
    });

    it("should return token when AOP_AUTH_TOKEN is set", () => {
      process.env.AOP_AUTH_TOKEN = "test-api-key";

      const key = getApiKey();
      expect(key).toBe("test-api-key");
    });

    it("should throw when AOP_AUTH_TOKEN is not set", () => {
      expect(() => getApiKey()).toThrow("Not authenticated");
    });
  });

  describe("getAnthropicModel", () => {
    it("should return a model for valid model ID", () => {
      const model = getAnthropicModel("claude-sonnet-4-5");
      expect(model).toBeDefined();
      expect(model.id).toBe("claude-sonnet-4-5");
    });

    it("should map legacy model IDs", () => {
      const model = getAnthropicModel("claude-sonnet-4-20250514");
      expect(model).toBeDefined();
      expect(model.id).toBe("claude-sonnet-4-5");
    });
  });
});
