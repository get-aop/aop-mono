import { describe, expect, test } from "bun:test";
import { findFreePort } from "./test-context";

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
