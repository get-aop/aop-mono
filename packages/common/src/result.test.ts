import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { err, isErr, isOk, ok, parseBody, type Result, safeParseJson } from "./result.ts";

describe("result", () => {
  describe("ok", () => {
    it("creates a success result with the given response", () => {
      const result = ok(42);
      expect(result).toEqual({ success: true, response: 42 });
    });

    it("creates a success result with an object response", () => {
      const result = ok({ id: "abc", name: "test" });
      expect(result).toEqual({ success: true, response: { id: "abc", name: "test" } });
    });

    it("creates a success result with null response", () => {
      const result = ok(null);
      expect(result).toEqual({ success: true, response: null });
    });
  });

  describe("err", () => {
    it("creates an error result with a string error", () => {
      const result = err("something went wrong");
      expect(result).toEqual({ success: false, error: "something went wrong" });
    });

    it("creates an error result with a structured error", () => {
      const result = err({ code: "NOT_FOUND", message: "not found" });
      expect(result).toEqual({
        success: false,
        error: { code: "NOT_FOUND", message: "not found" },
      });
    });
  });

  describe("isOk", () => {
    it("returns true for success results", () => {
      const result = ok("data");
      expect(isOk(result)).toBe(true);
    });

    it("returns false for error results", () => {
      const result = err("fail");
      expect(isOk(result)).toBe(false);
    });

    it("narrows the type so .response is accessible", () => {
      const result: Result<number, string> = ok(10);
      if (isOk(result)) {
        expect(result.response).toBe(10);
      }
    });
  });

  describe("isErr", () => {
    it("returns true for error results", () => {
      const result = err("fail");
      expect(isErr(result)).toBe(true);
    });

    it("returns false for success results", () => {
      const result = ok("data");
      expect(isErr(result)).toBe(false);
    });

    it("narrows the type so .error is accessible", () => {
      const result: Result<number, string> = err("oops");
      if (isErr(result)) {
        expect(result.error).toBe("oops");
      }
    });
  });

  describe("parseBody", () => {
    const schema = z.object({
      name: z.string(),
      age: z.number(),
    });

    it("returns ok with parsed data for valid input", () => {
      const result = parseBody(schema, { name: "Alice", age: 30 });
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.response).toEqual({ name: "Alice", age: 30 });
      }
    });

    it("returns err with validation details for invalid input", () => {
      const result = parseBody(schema, { name: 123 });
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.message).toBe("Invalid request");
        expect(result.error.details.length).toBeGreaterThan(0);
      }
    });

    it("returns err for completely wrong input", () => {
      const result = parseBody(schema, "not an object");
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.message).toBe("Invalid request");
      }
    });

    it("returns err for null input", () => {
      const result = parseBody(schema, null);
      expect(isErr(result)).toBe(true);
    });

    it("strips extra fields per Zod defaults", () => {
      const result = parseBody(schema, { name: "Bob", age: 25, extra: "field" });
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.response).toEqual({ name: "Bob", age: 25 });
      }
    });
  });

  describe("safeParseJson", () => {
    const schema = z.object({ name: z.string() });

    const mockRequest = (body: unknown) => ({
      json: async () => body,
    });

    const badJsonRequest = () => ({
      json: async () => {
        throw new Error("Unexpected end of JSON input");
      },
    });

    it("returns ok with parsed data for valid JSON and valid schema", async () => {
      const result = await safeParseJson(schema, mockRequest({ name: "Alice" }));
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.response).toEqual({ name: "Alice" });
      }
    });

    it("returns err with validation details for invalid schema", async () => {
      const result = await safeParseJson(schema, mockRequest({ name: 123 }));
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.message).toBe("Invalid request");
        expect(result.error.details.length).toBeGreaterThan(0);
      }
    });

    it("returns err with 'Invalid JSON' for malformed JSON", async () => {
      const result = await safeParseJson(schema, badJsonRequest());
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.message).toBe("Invalid JSON");
        expect(result.error.details).toEqual([]);
      }
    });
  });
});
