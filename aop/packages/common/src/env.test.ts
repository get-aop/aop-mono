import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { AOP_PORTS, AOP_URLS } from "./env.ts";

describe("env", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Clear relevant env vars before each test
    delete process.env.AOP_SERVER_PORT;
    delete process.env.AOP_LOCAL_SERVER_PORT;
    delete process.env.AOP_DASHBOARD_PORT;
    delete process.env.AOP_SERVER_URL;
    delete process.env.AOP_LOCAL_SERVER_URL;
    delete process.env.AOP_DASHBOARD_URL;
    delete process.env.AOP_DATABASE_URL;
  });

  afterEach(() => {
    // Restore original env
    process.env = { ...originalEnv };
  });

  describe("AOP_PORTS", () => {
    it("returns SERVER port when set", () => {
      process.env.AOP_SERVER_PORT = "3000";
      expect(AOP_PORTS.SERVER).toBe(3000);
    });

    it("throws when SERVER port not set", () => {
      expect(() => AOP_PORTS.SERVER).toThrow(
        "Missing required environment variable: AOP_SERVER_PORT",
      );
    });

    it("throws when SERVER port is not a number", () => {
      process.env.AOP_SERVER_PORT = "not-a-number";
      expect(() => AOP_PORTS.SERVER).toThrow("Invalid number for AOP_SERVER_PORT: not-a-number");
    });

    it("returns LOCAL_SERVER port when set", () => {
      process.env.AOP_LOCAL_SERVER_PORT = "3001";
      expect(AOP_PORTS.LOCAL_SERVER).toBe(3001);
    });

    it("throws when LOCAL_SERVER port not set", () => {
      expect(() => AOP_PORTS.LOCAL_SERVER).toThrow(
        "Missing required environment variable: AOP_LOCAL_SERVER_PORT",
      );
    });

    it("returns DASHBOARD port when set", () => {
      process.env.AOP_DASHBOARD_PORT = "3002";
      expect(AOP_PORTS.DASHBOARD).toBe(3002);
    });

    it("throws when DASHBOARD port not set", () => {
      expect(() => AOP_PORTS.DASHBOARD).toThrow(
        "Missing required environment variable: AOP_DASHBOARD_PORT",
      );
    });

    it("returns SIDECAR_PORT_START and SIDECAR_PORT_END as constants", () => {
      expect(AOP_PORTS.SIDECAR_PORT_START).toBe(3847);
      expect(AOP_PORTS.SIDECAR_PORT_END).toBe(3899);
    });
  });

  describe("AOP_URLS", () => {
    it("returns SERVER URL when set", () => {
      process.env.AOP_SERVER_URL = "https://api.example.com";
      expect(AOP_URLS.SERVER).toBe("https://api.example.com");
    });

    it("throws when SERVER URL not set", () => {
      expect(() => AOP_URLS.SERVER).toThrow(
        "Missing required environment variable: AOP_SERVER_URL",
      );
    });

    it("returns LOCAL_SERVER URL when set", () => {
      process.env.AOP_LOCAL_SERVER_URL = "http://localhost:3001";
      expect(AOP_URLS.LOCAL_SERVER).toBe("http://localhost:3001");
    });

    it("throws when LOCAL_SERVER URL not set", () => {
      expect(() => AOP_URLS.LOCAL_SERVER).toThrow(
        "Missing required environment variable: AOP_LOCAL_SERVER_URL",
      );
    });

    it("returns DASHBOARD URL when set", () => {
      process.env.AOP_DASHBOARD_URL = "http://localhost:3002";
      expect(AOP_URLS.DASHBOARD).toBe("http://localhost:3002");
    });

    it("throws when DASHBOARD URL not set", () => {
      expect(() => AOP_URLS.DASHBOARD).toThrow(
        "Missing required environment variable: AOP_DASHBOARD_URL",
      );
    });

    it("returns DATABASE URL when set", () => {
      process.env.AOP_DATABASE_URL = "postgresql://user:pass@localhost:5432/db";
      expect(AOP_URLS.DATABASE).toBe("postgresql://user:pass@localhost:5432/db");
    });

    it("throws when DATABASE URL not set", () => {
      expect(() => AOP_URLS.DATABASE).toThrow(
        "Missing required environment variable: AOP_DATABASE_URL",
      );
    });

    it("derives DATABASE_TEST by appending _test", () => {
      process.env.AOP_DATABASE_URL = "postgresql://user:pass@localhost:5432/mydb";
      expect(AOP_URLS.DATABASE_TEST).toBe("postgresql://user:pass@localhost:5432/mydb_test");
    });

    it("throws when deriving DATABASE_TEST with no DATABASE URL", () => {
      expect(() => AOP_URLS.DATABASE_TEST).toThrow(
        "Missing required environment variable: AOP_DATABASE_URL",
      );
    });
  });
});
