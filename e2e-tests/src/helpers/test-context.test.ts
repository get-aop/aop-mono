import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { findFreePort, resolveE2EAgentProvider } from "./test-context";

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
  test("prefers codex when codex is available", async () => {
    const binDir = await mkdtemp(join(tmpdir(), "aop-e2e-codex-"));

    try {
      await writeFile(join(binDir, "codex"), "");
      await writeFile(join(binDir, "agent"), "");
      await writeFile(join(binDir, "claude"), "");

      expect(resolveE2EAgentProvider(binDir)).toBe("codex");
    } finally {
      await rm(binDir, { recursive: true, force: true });
    }
  });

  test("falls back to cursor-cli when codex is unavailable but agent exists", async () => {
    const binDir = await mkdtemp(join(tmpdir(), "aop-e2e-agent-"));

    try {
      await writeFile(join(binDir, "agent"), "");

      expect(resolveE2EAgentProvider(binDir)).toBe("cursor-cli:composer-1.5");
    } finally {
      await rm(binDir, { recursive: true, force: true });
    }
  });

  test("falls back to claude-code when claude is the only available binary", async () => {
    const binDir = await mkdtemp(join(tmpdir(), "aop-e2e-claude-"));

    try {
      await writeFile(join(binDir, "claude"), "");

      expect(resolveE2EAgentProvider(binDir)).toBe("claude-code");
    } finally {
      await rm(binDir, { recursive: true, force: true });
    }
  });

  test("returns null when no supported provider binary is available", () => {
    expect(resolveE2EAgentProvider("/definitely/missing")).toBeNull();
  });
});
