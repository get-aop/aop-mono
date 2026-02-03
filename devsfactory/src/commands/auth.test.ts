import { describe, expect, it } from "bun:test";
import { parseAuthArgs } from "./auth";

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
});
