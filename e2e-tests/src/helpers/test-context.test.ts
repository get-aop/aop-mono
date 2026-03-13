import { describe, expect, test } from "bun:test";
import { DEFAULT_LOCAL_SERVER_PORT, DEFAULT_LOCAL_SERVER_URL } from "./constants";
import { findFreePort, resolveE2EAgentProvider } from "./test-context";

describe("E2E constants", () => {
  test("provide stable local defaults without requiring process env", () => {
    expect(DEFAULT_LOCAL_SERVER_PORT).toBe(25150);
    expect(DEFAULT_LOCAL_SERVER_URL).toBe("http://localhost:25150");
  });
});

describe("findFreePort", () => {
  test("finds a free port within the given range", async () => {
    const port = await findFreePort(30000, 30099);
    expect(port).toBeGreaterThanOrEqual(30000);
    expect(port).toBeLessThanOrEqual(30099);
  });

  test("returns different ports on successive calls", async () => {
    const ports = new Set<number>();
    for (let i = 0; i < 5; i++) {
      ports.add(await findFreePort(30100, 30199));
    }
    expect(ports.size).toBeGreaterThan(1);
  });

  test("throws when range is fully occupied", async () => {
    // Bind a port and try to find a free one in a range of 1
    const listener = Bun.listen({
      hostname: "127.0.0.1",
      port: 30200,
      socket: { data() {} },
    });

    try {
      await expect(findFreePort(30200, 30200)).rejects.toThrow("No free port in range 30200-30200");
    } finally {
      listener.stop(true);
    }
  });
});

describe("resolveE2EAgentProvider", () => {
  test("defaults to the deterministic fixture provider", () => {
    const original = process.env.AOP_E2E_AGENT_PROVIDER;
    try {
      delete process.env.AOP_E2E_AGENT_PROVIDER;
      expect(resolveE2EAgentProvider()).toBe("e2e-fixture");
    } finally {
      restoreProviderEnv(original);
    }
  });

  test("allows overriding the provider through the environment", () => {
    const original = process.env.AOP_E2E_AGENT_PROVIDER;
    try {
      process.env.AOP_E2E_AGENT_PROVIDER = "codex";
      expect(resolveE2EAgentProvider()).toBe("codex");
    } finally {
      restoreProviderEnv(original);
    }
  });

  test("ignores blank overrides", () => {
    const original = process.env.AOP_E2E_AGENT_PROVIDER;
    try {
      process.env.AOP_E2E_AGENT_PROVIDER = "   ";
      expect(resolveE2EAgentProvider()).toBe("e2e-fixture");
    } finally {
      restoreProviderEnv(original);
    }
  });
});

const restoreProviderEnv = (value: string | undefined): void => {
  if (value === undefined) {
    delete process.env.AOP_E2E_AGENT_PROVIDER;
    return;
  }

  process.env.AOP_E2E_AGENT_PROVIDER = value;
};
