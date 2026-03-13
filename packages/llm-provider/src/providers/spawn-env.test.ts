import { describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { delimiter } from "node:path";
import { buildSpawnEnv } from "./spawn-env";

describe("buildSpawnEnv", () => {
  test("augments PATH with common binary locations", () => {
    const env = buildSpawnEnv({ PATH: "/usr/bin:/bin" });
    const parts = (env.PATH ?? "").split(delimiter);

    expect(parts).toContain("/usr/local/bin");
    expect(parts).toContain("/opt/homebrew/bin");
    expect(parts).toContain(`${homedir()}/.local/bin`);
    expect(parts).toContain(`${homedir()}/.local/share/pnpm`);
    expect(parts).toContain(`${homedir()}/.local/share/pnpm/nodejs_current/bin`);
    expect(parts).toContain(`${homedir()}/.opencode/bin`);
  });

  test("does not duplicate entries already present in PATH", () => {
    const pathWithDuplicate = `/usr/bin:/bin:/usr/local/bin:${homedir()}/.local/bin:${homedir()}/.local/share/pnpm`;
    const env = buildSpawnEnv({ PATH: pathWithDuplicate });
    const parts = (env.PATH ?? "").split(delimiter);

    expect(parts.filter((p) => p === "/usr/local/bin")).toHaveLength(1);
    expect(parts.filter((p) => p === `${homedir()}/.local/bin`)).toHaveLength(1);
    expect(parts.filter((p) => p === `${homedir()}/.local/share/pnpm`)).toHaveLength(1);
  });
});
