import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import YAML from "yaml";
import { closeDatabase, resetDatabaseInstance } from "./sqlite/database";

const dirExists = async (path: string): Promise<boolean> => {
  try {
    const s = await stat(path);
    return s.isDirectory();
  } catch {
    return false;
  }
};

describe("global-bootstrap", () => {
  let tempDir: string;
  let originalHome: string | undefined;
  let originalUserProfile: string | undefined;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "aop-test-"));
    originalHome = process.env.HOME;
    originalUserProfile = process.env.USERPROFILE;
  });

  afterEach(async () => {
    process.env.HOME = originalHome;
    process.env.USERPROFILE = originalUserProfile;
    closeDatabase();
    resetDatabaseInstance();
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("getHomeDir", () => {
    test("returns HOME on Unix-like systems", async () => {
      process.env.HOME = "/home/testuser";
      delete process.env.USERPROFILE;

      const { getHomeDir } = await import("./global-bootstrap");
      expect(getHomeDir()).toBe("/home/testuser");
    });

    test("returns USERPROFILE on Windows when HOME is not set", async () => {
      delete process.env.HOME;
      process.env.USERPROFILE = "C:\\Users\\testuser";

      const mod = await reimportModule();
      expect(mod.getHomeDir()).toBe("C:\\Users\\testuser");
    });

    test("prefers HOME over USERPROFILE when both are set", async () => {
      process.env.HOME = "/home/testuser";
      process.env.USERPROFILE = "C:\\Users\\testuser";

      const mod = await reimportModule();
      expect(mod.getHomeDir()).toBe("/home/testuser");
    });

    test("throws error when neither HOME nor USERPROFILE is set", async () => {
      delete process.env.HOME;
      delete process.env.USERPROFILE;

      const mod = await reimportModule();
      expect(() => mod.getHomeDir()).toThrow(
        "Unable to determine home directory"
      );
    });
  });

  describe("getGlobalDir", () => {
    test("returns ~/.aop path", async () => {
      process.env.HOME = tempDir;

      const mod = await reimportModule();
      expect(mod.getGlobalDir()).toBe(join(tempDir, ".aop"));
    });

    test("returns override path when using runWithGlobalDir", async () => {
      process.env.HOME = tempDir;
      const overridePath = join(tempDir, "custom-aop");

      const mod = await reimportModule();
      const resultInContext = await mod.runWithGlobalDir(overridePath, () =>
        mod.getGlobalDir()
      );
      expect(resultInContext).toBe(overridePath);

      // Outside the context, should return default
      expect(mod.getGlobalDir()).toBe(join(tempDir, ".aop"));
    });
  });

  describe("getDefaultConfig", () => {
    test("returns default configuration object", async () => {
      const { getDefaultConfig } = await import("./global-bootstrap");
      const config = getDefaultConfig();

      expect(config.version).toBe(1);
      expect(config.defaults.maxConcurrentAgents).toBe(2);
      expect(config.defaults.dashboardPort).toBe(3001);
      expect(config.defaults.debounceMs).toBe(100);
      expect(config.defaults.retryBackoff).toEqual({
        initialMs: 2000,
        maxMs: 300000,
        maxAttempts: 5
      });
      expect(config.providers).toEqual({
        "claude-code": {
          model: "claude-opus-4-5-20251101"
        }
      });
    });

    test("config is valid against GlobalConfigSchema", async () => {
      const { getDefaultConfig } = await import("./global-bootstrap");
      const { GlobalConfigSchema } = await import("../types");

      const config = getDefaultConfig();
      const result = GlobalConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });
  });

  describe("ensureGlobalDir", () => {
    test("creates ~/.aop directory structure when it doesn't exist", async () => {
      process.env.HOME = tempDir;

      const mod = await reimportModule();
      const result = await mod.ensureGlobalDir();

      expect(result).toBe(join(tempDir, ".aop"));
      expect(await dirExists(join(tempDir, ".aop"))).toBe(true);
      expect(
        await Bun.file(join(tempDir, ".aop", "config.yaml")).exists()
      ).toBe(true);
      // SQLite database should be created
      expect(await Bun.file(join(tempDir, ".aop", "aop.db")).exists()).toBe(
        true
      );
      // File-based subdirectories
      expect(await dirExists(join(tempDir, ".aop", "worktrees"))).toBe(true);
      expect(await dirExists(join(tempDir, ".aop", "logs"))).toBe(true);
      // Brainstorm data is now stored in SQLite, no directory created
    });

    test("creates config.yaml with correct default content", async () => {
      process.env.HOME = tempDir;

      const mod = await reimportModule();
      await mod.ensureGlobalDir();

      const configPath = join(tempDir, ".aop", "config.yaml");
      const content = await Bun.file(configPath).text();
      const parsed = YAML.parse(content);

      expect(parsed.version).toBe(1);
      expect(parsed.defaults.maxConcurrentAgents).toBe(2);
      expect(parsed.defaults.dashboardPort).toBe(3001);
      expect(parsed.defaults.debounceMs).toBe(100);
      expect(parsed.defaults.retryBackoff.initialMs).toBe(2000);
      expect(parsed.defaults.retryBackoff.maxMs).toBe(300000);
      expect(parsed.defaults.retryBackoff.maxAttempts).toBe(5);
      expect(parsed.providers["claude-code"].model).toBe(
        "claude-opus-4-5-20251101"
      );
    });

    test("returns existing path when ~/.aop already exists", async () => {
      process.env.HOME = tempDir;
      const aopDir = join(tempDir, ".aop");

      await Bun.write(join(aopDir, "config.yaml"), "version: 1\n");

      const mod = await reimportModule();
      const result = await mod.ensureGlobalDir();

      expect(result).toBe(aopDir);
    });

    test("does not overwrite existing config.yaml", async () => {
      process.env.HOME = tempDir;
      const aopDir = join(tempDir, ".aop");
      const configPath = join(aopDir, "config.yaml");

      const customConfig = "version: 2\ncustomSetting: true\n";
      await Bun.write(configPath, customConfig);

      const mod = await reimportModule();
      await mod.ensureGlobalDir();

      const content = await Bun.file(configPath).text();
      expect(content).toBe(customConfig);
    });

    test("creates missing subdirectories even if ~/.aop exists", async () => {
      process.env.HOME = tempDir;
      const aopDir = join(tempDir, ".aop");

      await Bun.write(join(aopDir, "config.yaml"), "version: 1\n");

      const mod = await reimportModule();
      await mod.ensureGlobalDir();

      // SQLite database should be created
      expect(await Bun.file(join(aopDir, "aop.db")).exists()).toBe(true);
      // File-based subdirectories
      expect(await dirExists(join(aopDir, "worktrees"))).toBe(true);
      expect(await dirExists(join(aopDir, "logs"))).toBe(true);
      // Brainstorm data is now stored in SQLite, no directory created
    });

    test("is idempotent - can be called multiple times", async () => {
      process.env.HOME = tempDir;

      const mod = await reimportModule();
      const result1 = await mod.ensureGlobalDir();
      const result2 = await mod.ensureGlobalDir();
      const result3 = await mod.ensureGlobalDir();

      expect(result1).toBe(result2);
      expect(result2).toBe(result3);
      expect(result1).toBe(join(tempDir, ".aop"));
    });
  });
});

async function reimportModule() {
  const timestamp = Date.now();
  return await import(`./global-bootstrap?t=${timestamp}`);
}
