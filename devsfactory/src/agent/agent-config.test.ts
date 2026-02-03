import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import YAML from "yaml";
import {
  finalizeConfig,
  loadConfig,
  loadConfigFromArgs,
  loadConfigFromEnv,
  loadConfigFromFile,
  mergeConfigs,
  saveConfig
} from "./agent-config";

describe("agent-config (YAML)", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "agent-config-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
    // Clean up environment variables
    delete process.env.AOP_SERVER_URL;
    delete process.env.AOP_SECRET;
    delete process.env.AOP_CLIENT_ID;
    delete process.env.AOP_MACHINE_ID;
    delete process.env.AOP_MODEL;
    delete process.env.AOP_MAX_CONCURRENT_JOBS;
    delete process.env.AOP_LOG_LEVEL;
    delete process.env.AOP_PROJECT_NAME;
    delete process.env.AOP_DEVSFACTORY_DIR;
  });

  describe("loadConfigFromFile", () => {
    it("should load agent config from YAML config.yaml", async () => {
      const configPath = join(tempDir, "config.yaml");
      const config = {
        version: 1,
        defaults: {},
        providers: {},
        server: { url: "http://localhost:3001" },
        agent: {
          serverUrl: "wss://test-server.example.com/api/agents",
          secret: "test-secret-12345678",
          projectName: "test-project",
          devsfactoryDir: "/path/to/.devsfactory",
          model: "sonnet",
          maxConcurrentJobs: 2,
          logLevel: "debug"
        }
      };

      await Bun.write(configPath, YAML.stringify(config));

      const loaded = await loadConfigFromFile(configPath);

      expect(loaded).not.toBeNull();
      expect(loaded?.serverUrl).toBe(
        "wss://test-server.example.com/api/agents"
      );
      expect(loaded?.secret).toBe("test-secret-12345678");
      expect(loaded?.projectName).toBe("test-project");
      expect(loaded?.devsfactoryDir).toBe("/path/to/.devsfactory");
      expect(loaded?.model).toBe("sonnet");
      expect(loaded?.maxConcurrentJobs).toBe(2);
      expect(loaded?.logLevel).toBe("debug");
    });

    it("should return null when config file does not exist", async () => {
      const configPath = join(tempDir, "nonexistent.yaml");
      const loaded = await loadConfigFromFile(configPath);
      expect(loaded).toBeNull();
    });

    it("should return null when config has no agent section", async () => {
      const configPath = join(tempDir, "config.yaml");
      const config = {
        version: 1,
        defaults: {},
        providers: {},
        server: { url: "http://localhost:3001" }
      };

      await Bun.write(configPath, YAML.stringify(config));

      const loaded = await loadConfigFromFile(configPath);
      expect(loaded).toBeNull();
    });
  });

  describe("loadConfigFromEnv", () => {
    it("should load config from environment variables", () => {
      process.env.AOP_SERVER_URL = "wss://env-server.example.com";
      process.env.AOP_SECRET = "env-secret-12345678";
      process.env.AOP_CLIENT_ID = "env-client-id";
      process.env.AOP_MACHINE_ID = "env-machine";
      process.env.AOP_MODEL = "haiku";
      process.env.AOP_MAX_CONCURRENT_JOBS = "3";
      process.env.AOP_LOG_LEVEL = "warn";
      process.env.AOP_PROJECT_NAME = "env-project";
      process.env.AOP_DEVSFACTORY_DIR = "/env/devsfactory";

      const config = loadConfigFromEnv();

      expect(config.serverUrl).toBe("wss://env-server.example.com");
      expect(config.secret).toBe("env-secret-12345678");
      expect(config.clientId).toBe("env-client-id");
      expect(config.machineId).toBe("env-machine");
      expect(config.model).toBe("haiku");
      expect(config.maxConcurrentJobs).toBe(3);
      expect(config.logLevel).toBe("warn");
      expect(config.projectName).toBe("env-project");
      expect(config.devsfactoryDir).toBe("/env/devsfactory");
    });

    it("should ignore invalid model values", () => {
      process.env.AOP_MODEL = "invalid-model";
      const config = loadConfigFromEnv();
      expect(config.model).toBeUndefined();
    });

    it("should ignore invalid max concurrent jobs values", () => {
      process.env.AOP_MAX_CONCURRENT_JOBS = "15"; // > 10
      const config = loadConfigFromEnv();
      expect(config.maxConcurrentJobs).toBeUndefined();
    });
  });

  describe("loadConfigFromArgs", () => {
    it("should parse command line arguments", () => {
      const args = [
        "--server",
        "wss://arg-server.example.com",
        "--secret",
        "arg-secret-12345678",
        "--client-id",
        "arg-client",
        "--machine-id",
        "arg-machine",
        "--model",
        "opus",
        "--max-jobs",
        "5",
        "--log-level",
        "error",
        "--project-name",
        "arg-project",
        "--devsfactory-dir",
        "/arg/devsfactory"
      ];

      const config = loadConfigFromArgs(args);

      expect(config.serverUrl).toBe("wss://arg-server.example.com");
      expect(config.secret).toBe("arg-secret-12345678");
      expect(config.clientId).toBe("arg-client");
      expect(config.machineId).toBe("arg-machine");
      expect(config.model).toBe("opus");
      expect(config.maxConcurrentJobs).toBe(5);
      expect(config.logLevel).toBe("error");
      expect(config.projectName).toBe("arg-project");
      expect(config.devsfactoryDir).toBe("/arg/devsfactory");
    });

    it("should parse short form arguments", () => {
      const args = ["-s", "wss://short.example.com", "-m", "sonnet"];

      const config = loadConfigFromArgs(args);

      expect(config.serverUrl).toBe("wss://short.example.com");
      expect(config.model).toBe("sonnet");
    });

    it("should parse --no-reconnect flag", () => {
      const args = ["--no-reconnect"];
      const config = loadConfigFromArgs(args);
      expect(config.reconnect).toBe(false);
    });
  });

  describe("mergeConfigs", () => {
    it("should merge configs with priority: args > env > file", () => {
      const fileConfig = {
        serverUrl: "wss://file.example.com",
        secret: "file-secret-1234",
        model: "sonnet" as const,
        projectName: "file-project",
        devsfactoryDir: "/file/path"
      };

      const envConfig = {
        serverUrl: "wss://env.example.com",
        model: "haiku" as const
      };

      const argsConfig = {
        model: "opus" as const
      };

      const merged = mergeConfigs(fileConfig, envConfig, argsConfig);

      // Args override
      expect(merged.model).toBe("opus");
      // Env overrides file
      expect(merged.serverUrl).toBe("wss://env.example.com");
      // File values preserved
      expect(merged.secret).toBe("file-secret-1234");
      expect(merged.projectName).toBe("file-project");
    });
  });

  describe("finalizeConfig", () => {
    it("should apply defaults for optional fields", async () => {
      const partial = {
        serverUrl: "wss://test.example.com",
        secret: "test-secret-12345678",
        projectName: "test-project",
        devsfactoryDir: "/test/devsfactory"
      };

      const result = await finalizeConfig(partial);

      expect("config" in result).toBe(true);
      if ("config" in result) {
        expect(result.config.clientId).toBeDefined();
        expect(result.config.machineId).toBeDefined();
        expect(result.config.maxConcurrentJobs).toBe(1);
        expect(result.config.reconnect).toBe(true);
        expect(result.config.logLevel).toBe("info");
      }
    });

    it("should return error for missing required fields", async () => {
      const partial = {
        serverUrl: "wss://test.example.com"
        // missing secret, projectName, devsfactoryDir
      };

      const result = await finalizeConfig(partial);

      expect("error" in result).toBe(true);
    });

    it("should return error for invalid server URL", async () => {
      const partial = {
        serverUrl: "not-a-valid-url",
        secret: "test-secret-12345678",
        projectName: "test-project",
        devsfactoryDir: "/test/devsfactory"
      };

      const result = await finalizeConfig(partial);

      expect("error" in result).toBe(true);
    });

    it("should return error for secret less than 16 characters", async () => {
      const partial = {
        serverUrl: "wss://test.example.com",
        secret: "short",
        projectName: "test-project",
        devsfactoryDir: "/test/devsfactory"
      };

      const result = await finalizeConfig(partial);

      expect("error" in result).toBe(true);
    });
  });

  describe("loadConfig", () => {
    it("should load complete config from YAML file with env and args override", async () => {
      const configPath = join(tempDir, "config.yaml");
      const config = {
        version: 1,
        defaults: {},
        providers: {},
        server: { url: "http://localhost:3001" },
        agent: {
          serverUrl: "wss://file-server.example.com",
          secret: "file-secret-12345678",
          projectName: "file-project",
          devsfactoryDir: "/file/devsfactory",
          model: "sonnet"
        }
      };

      await Bun.write(configPath, YAML.stringify(config));

      process.env.AOP_MODEL = "haiku";

      const args = ["--log-level", "debug"];
      const result = await loadConfig(args, configPath);

      expect("config" in result).toBe(true);
      if ("config" in result) {
        expect(result.config.serverUrl).toBe("wss://file-server.example.com");
        expect(result.config.secret).toBe("file-secret-12345678");
        expect(result.config.model).toBe("haiku"); // env override
        expect(result.config.logLevel).toBe("debug"); // args override
      }
    });
  });

  describe("saveConfig", () => {
    it("should save config to YAML file under agent key", async () => {
      const configPath = join(tempDir, "config.yaml");

      // Create initial config
      const initialConfig = {
        version: 1,
        defaults: { maxConcurrentAgents: 2 },
        providers: {},
        server: { url: "http://localhost:3001" }
      };
      await Bun.write(configPath, YAML.stringify(initialConfig));

      const agentConfig = {
        serverUrl: "wss://saved.example.com",
        secret: "saved-secret-12345678",
        projectName: "saved-project",
        repoPath: "/saved/repo",
        devsfactoryDir: "/saved/devsfactory",
        maxConcurrentJobs: 1,
        reconnect: true,
        logLevel: "info" as const
      };

      await saveConfig(agentConfig, configPath);

      const content = await Bun.file(configPath).text();
      const saved = YAML.parse(content);

      // Verify agent section was added
      expect(saved.agent).toBeDefined();
      expect(saved.agent.serverUrl).toBe("wss://saved.example.com");
      expect(saved.agent.secret).toBe("saved-secret-12345678");
      // Verify existing config preserved
      expect(saved.version).toBe(1);
      expect(saved.defaults.maxConcurrentAgents).toBe(2);
    });

    it("should create new YAML file if it does not exist", async () => {
      const configPath = join(tempDir, "new-config.yaml");

      const agentConfig = {
        serverUrl: "wss://new.example.com",
        secret: "new-secret-12345678",
        projectName: "new-project",
        repoPath: "/new/repo",
        devsfactoryDir: "/new/devsfactory",
        maxConcurrentJobs: 1,
        reconnect: true,
        logLevel: "info" as const
      };

      await saveConfig(agentConfig, configPath);

      const exists = await Bun.file(configPath).exists();
      expect(exists).toBe(true);

      const content = await Bun.file(configPath).text();
      const saved = YAML.parse(content);
      expect(saved.agent.serverUrl).toBe("wss://new.example.com");
    });
  });
});
