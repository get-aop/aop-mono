import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import YAML from "yaml";
import {
  createIsolatedGlobalDir,
  type IsolatedGlobalDirContext
} from "../test-helpers";

describe("global-config", () => {
  let ctx: IsolatedGlobalDirContext;
  let originalEnv: Record<string, string | undefined>;

  beforeEach(async () => {
    ctx = await createIsolatedGlobalDir("global-config");
    originalEnv = {
      MAX_CONCURRENT_AGENTS: process.env.MAX_CONCURRENT_AGENTS,
      DEBOUNCE_MS: process.env.DEBOUNCE_MS,
      DASHBOARD_PORT: process.env.DASHBOARD_PORT,
      RETRY_INITIAL_MS: process.env.RETRY_INITIAL_MS,
      RETRY_MAX_MS: process.env.RETRY_MAX_MS,
      RETRY_MAX_ATTEMPTS: process.env.RETRY_MAX_ATTEMPTS
    };
    delete process.env.MAX_CONCURRENT_AGENTS;
    delete process.env.DEBOUNCE_MS;
    delete process.env.DASHBOARD_PORT;
    delete process.env.RETRY_INITIAL_MS;
    delete process.env.RETRY_MAX_MS;
    delete process.env.RETRY_MAX_ATTEMPTS;
  });

  afterEach(async () => {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    await ctx.cleanup();
  });

  async function reimportModule() {
    const timestamp = Date.now();
    return await import(`./global-config?t=${timestamp}`);
  }

  const runInCtx = <T>(fn: () => T | Promise<T>) => ctx.run(fn);

  describe("deepMerge", () => {
    test("merges two flat objects", async () => {
      const mod = await reimportModule();
      const result = mod.deepMerge({ a: 1, b: 2 }, { b: 3, c: 4 });
      expect(result).toEqual({ a: 1, b: 3, c: 4 });
    });

    test("deep merges nested objects", async () => {
      const mod = await reimportModule();
      const result = mod.deepMerge(
        { nested: { a: 1, b: 2 } },
        { nested: { b: 3, c: 4 } }
      );
      expect(result).toEqual({ nested: { a: 1, b: 3, c: 4 } });
    });

    test("replaces arrays instead of concatenating", async () => {
      const mod = await reimportModule();
      const result = mod.deepMerge({ arr: [1, 2, 3] }, { arr: [4, 5] });
      expect(result).toEqual({ arr: [4, 5] });
    });

    test("handles null values in source", async () => {
      const mod = await reimportModule();
      const result = mod.deepMerge({ a: 1 }, { a: null });
      expect(result).toEqual({ a: null });
    });

    test("handles undefined values in source (keeps target)", async () => {
      const mod = await reimportModule();
      const result = mod.deepMerge({ a: 1 }, { a: undefined });
      expect(result).toEqual({ a: 1 });
    });

    test("creates new properties from source", async () => {
      const mod = await reimportModule();
      const result = mod.deepMerge({}, { newProp: "value" });
      expect(result).toEqual({ newProp: "value" });
    });

    test("handles deeply nested objects", async () => {
      const mod = await reimportModule();
      const result = mod.deepMerge(
        { a: { b: { c: { d: 1 } } } },
        { a: { b: { c: { e: 2 } } } }
      );
      expect(result).toEqual({ a: { b: { c: { d: 1, e: 2 } } } });
    });

    test("replaces primitive with object", async () => {
      const mod = await reimportModule();
      const result = mod.deepMerge({ a: 1 }, { a: { nested: true } });
      expect(result).toEqual({ a: { nested: true } });
    });

    test("replaces object with primitive", async () => {
      const mod = await reimportModule();
      const result = mod.deepMerge({ a: { nested: true } }, { a: 1 });
      expect(result).toEqual({ a: 1 });
    });
  });

  describe("loadGlobalConfig", () => {
    test("returns default config when file does not exist", async () => {
      const mod = await reimportModule();
      const config = await runInCtx(() => mod.loadGlobalConfig());

      expect(config.version).toBe(1);
      expect(config.defaults).toBeDefined();
      expect(config.providers).toBeDefined();
    });

    test("loads config from ~/.aop/config.yaml", async () => {
      const customConfig = {
        version: 1,
        defaults: { maxConcurrentAgents: 5 },
        providers: { "custom-provider": { model: "custom-model" } }
      };
      await Bun.write(
        join(ctx.globalDir, "config.yaml"),
        YAML.stringify(customConfig)
      );

      const mod = await reimportModule();
      const config = await runInCtx(() => mod.loadGlobalConfig());

      expect(config.defaults.maxConcurrentAgents).toBe(5);
      expect(config.providers["custom-provider"]?.model).toBe("custom-model");
    });

    test("validates config against GlobalConfigSchema", async () => {
      const invalidConfig = { version: "invalid" };
      await Bun.write(
        join(ctx.globalDir, "config.yaml"),
        YAML.stringify(invalidConfig)
      );

      const mod = await reimportModule();
      await expect(runInCtx(() => mod.loadGlobalConfig())).rejects.toThrow();
    });

    test("applies schema defaults to partial config", async () => {
      const partialConfig = { version: 1 };
      await Bun.write(
        join(ctx.globalDir, "config.yaml"),
        YAML.stringify(partialConfig)
      );

      const mod = await reimportModule();
      const config = await runInCtx(() => mod.loadGlobalConfig());

      expect(config.defaults).toBeDefined();
      expect(config.providers).toBeDefined();
    });
  });

  describe("loadProjectConfig", () => {
    test("returns null when project file does not exist", async () => {
      const mod = await reimportModule();
      const config = await runInCtx(() =>
        mod.loadProjectConfig("nonexistent-project")
      );

      expect(config).toBeNull();
    });

    test("loads project config from ~/.aop/projects/<name>.yaml", async () => {
      const projectConfig = {
        name: "my-project",
        path: "/path/to/project",
        gitRemote: "git@github.com:user/repo.git",
        registered: new Date().toISOString(),
        settings: { maxConcurrentAgents: 4 },
        providers: { "claude-code": { model: "opus" } }
      };
      await Bun.write(
        join(ctx.globalDir, "projects", "my-project.yaml"),
        YAML.stringify(projectConfig)
      );

      const mod = await reimportModule();
      const config = await runInCtx(() => mod.loadProjectConfig("my-project"));

      expect(config).not.toBeNull();
      expect(config!.name).toBe("my-project");
      expect(config!.settings?.maxConcurrentAgents).toBe(4);
      expect(config!.providers?.["claude-code"]?.model).toBe("opus");
    });

    test("validates project config against ProjectConfigSchema", async () => {
      const invalidConfig = { name: 123 };
      await Bun.write(
        join(ctx.globalDir, "projects", "invalid.yaml"),
        YAML.stringify(invalidConfig)
      );

      const mod = await reimportModule();
      await expect(
        runInCtx(() => mod.loadProjectConfig("invalid"))
      ).rejects.toThrow();
    });
  });

  describe("mergeConfigs", () => {
    test("returns global defaults when no project config", async () => {
      const mod = await reimportModule();
      const globalConfig = {
        version: 1,
        defaults: { maxConcurrentAgents: 2, debounceMs: 100 },
        providers: {}
      };

      const result = mod.mergeConfigs(globalConfig);

      expect(result.maxConcurrentAgents).toBe(2);
      expect(result.debounceMs).toBe(100);
    });

    test("project settings override global defaults", async () => {
      const mod = await reimportModule();
      const globalConfig = {
        version: 1,
        defaults: { maxConcurrentAgents: 2, debounceMs: 100 },
        providers: {}
      };
      const projectConfig = {
        name: "test",
        path: "/test",
        gitRemote: null,
        registered: new Date(),
        settings: { maxConcurrentAgents: 5 }
      };

      const result = mod.mergeConfigs(globalConfig, projectConfig);

      expect(result.maxConcurrentAgents).toBe(5);
      expect(result.debounceMs).toBe(100);
    });

    test("deep merges nested provider configs", async () => {
      const mod = await reimportModule();
      const globalConfig = {
        version: 1,
        defaults: {},
        providers: {
          "claude-code": { model: "sonnet", env: { API_KEY: "global-key" } }
        }
      };
      const projectConfig = {
        name: "test",
        path: "/test",
        gitRemote: null,
        registered: new Date(),
        providers: {
          "claude-code": { model: "opus" }
        }
      };

      const result = mod.mergeConfigs(globalConfig, projectConfig);

      expect(result.providers?.["claude-code"]?.model).toBe("opus");
      expect(result.providers?.["claude-code"]?.env?.API_KEY).toBe(
        "global-key"
      );
    });

    test("adds new providers from project config", async () => {
      const mod = await reimportModule();
      const globalConfig = {
        version: 1,
        defaults: {},
        providers: { "claude-code": { model: "sonnet" } }
      };
      const projectConfig = {
        name: "test",
        path: "/test",
        gitRemote: null,
        registered: new Date(),
        providers: { "custom-provider": { model: "custom" } }
      };

      const result = mod.mergeConfigs(globalConfig, projectConfig);

      expect(result.providers?.["claude-code"]?.model).toBe("sonnet");
      expect(result.providers?.["custom-provider"]?.model).toBe("custom");
    });

    test("deep merges retryBackoff settings", async () => {
      const mod = await reimportModule();
      const globalConfig = {
        version: 1,
        defaults: {
          retryBackoff: { initialMs: 2000, maxMs: 300000, maxAttempts: 5 }
        },
        providers: {}
      };
      const projectConfig = {
        name: "test",
        path: "/test",
        gitRemote: null,
        registered: new Date(),
        settings: { retryBackoff: { maxAttempts: 10 } }
      };

      const result = mod.mergeConfigs(globalConfig, projectConfig);

      expect(result.retryBackoff?.initialMs).toBe(2000);
      expect(result.retryBackoff?.maxMs).toBe(300000);
      expect(result.retryBackoff?.maxAttempts).toBe(10);
    });
  });

  describe("resolveConfig", () => {
    test("loads global config when no project specified", async () => {
      const globalConfig = {
        version: 1,
        defaults: { maxConcurrentAgents: 3 },
        providers: {}
      };
      await Bun.write(
        join(ctx.globalDir, "config.yaml"),
        YAML.stringify(globalConfig)
      );

      const mod = await reimportModule();
      const config = await runInCtx(() => mod.resolveConfig());

      expect(config.maxConcurrentAgents).toBe(3);
    });

    test("merges global and project config when project specified", async () => {
      const globalConfig = {
        version: 1,
        defaults: { maxConcurrentAgents: 2, debounceMs: 100 },
        providers: {}
      };
      await Bun.write(
        join(ctx.globalDir, "config.yaml"),
        YAML.stringify(globalConfig)
      );

      const projectConfig = {
        name: "my-project",
        path: "/project",
        gitRemote: null,
        registered: new Date().toISOString(),
        settings: { maxConcurrentAgents: 5 }
      };
      await Bun.write(
        join(ctx.globalDir, "projects", "my-project.yaml"),
        YAML.stringify(projectConfig)
      );

      const mod = await reimportModule();
      const config = await runInCtx(() => mod.resolveConfig("my-project"));

      expect(config.maxConcurrentAgents).toBe(5);
      expect(config.debounceMs).toBe(100);
    });

    test("applies environment variable overrides", async () => {
      const globalConfig = {
        version: 1,
        defaults: { maxConcurrentAgents: 2 },
        providers: {}
      };
      await Bun.write(
        join(ctx.globalDir, "config.yaml"),
        YAML.stringify(globalConfig)
      );

      process.env.MAX_CONCURRENT_AGENTS = "10";

      const mod = await reimportModule();
      const config = await runInCtx(() => mod.resolveConfig());

      expect(config.maxConcurrentAgents).toBe(10);
    });

    test("env vars override project settings", async () => {
      const globalConfig = {
        version: 1,
        defaults: { maxConcurrentAgents: 2 },
        providers: {}
      };
      await Bun.write(
        join(ctx.globalDir, "config.yaml"),
        YAML.stringify(globalConfig)
      );

      const projectConfig = {
        name: "my-project",
        path: "/project",
        gitRemote: null,
        registered: new Date().toISOString(),
        settings: { maxConcurrentAgents: 5 }
      };
      await Bun.write(
        join(ctx.globalDir, "projects", "my-project.yaml"),
        YAML.stringify(projectConfig)
      );

      process.env.MAX_CONCURRENT_AGENTS = "15";

      const mod = await reimportModule();
      const config = await runInCtx(() => mod.resolveConfig("my-project"));

      expect(config.maxConcurrentAgents).toBe(15);
    });

    test("applies DEBOUNCE_MS env var override", async () => {
      const globalConfig = { version: 1, defaults: {}, providers: {} };
      await Bun.write(
        join(ctx.globalDir, "config.yaml"),
        YAML.stringify(globalConfig)
      );

      process.env.DEBOUNCE_MS = "500";

      const mod = await reimportModule();
      const config = await runInCtx(() => mod.resolveConfig());

      expect(config.debounceMs).toBe(500);
    });

    test("applies retry backoff env var overrides", async () => {
      const globalConfig = { version: 1, defaults: {}, providers: {} };
      await Bun.write(
        join(ctx.globalDir, "config.yaml"),
        YAML.stringify(globalConfig)
      );

      process.env.RETRY_INITIAL_MS = "5000";
      process.env.RETRY_MAX_MS = "600000";
      process.env.RETRY_MAX_ATTEMPTS = "10";

      const mod = await reimportModule();
      const config = await runInCtx(() => mod.resolveConfig());

      expect(config.retryBackoff?.initialMs).toBe(5000);
      expect(config.retryBackoff?.maxMs).toBe(600000);
      expect(config.retryBackoff?.maxAttempts).toBe(10);
    });

    test("returns null project when project not found", async () => {
      const globalConfig = {
        version: 1,
        defaults: { maxConcurrentAgents: 2 },
        providers: {}
      };
      await Bun.write(
        join(ctx.globalDir, "config.yaml"),
        YAML.stringify(globalConfig)
      );

      const mod = await reimportModule();
      const config = await runInCtx(() =>
        mod.resolveConfig("nonexistent-project")
      );

      expect(config.maxConcurrentAgents).toBe(2);
    });
  });
});
