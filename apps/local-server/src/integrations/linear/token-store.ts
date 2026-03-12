import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, release } from "node:os";
import { dirname, join } from "node:path";
import type { LinearTokenSet, LinearTokenStore, LinearTokenStoreStatus } from "./types.ts";

interface ExecInvocation {
  args: string[];
  env?: Record<string, string | undefined>;
  stdin?: string;
}

interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

type CommandExecutor = (invocation: ExecInvocation) => Promise<ExecResult>;

const DEFAULT_ACCOUNT = "default";
const DEFAULT_SERVICE = "aop.linear.oauth";

export const createLinearTokenStore = (options?: {
  accountName?: string;
  exec?: CommandExecutor;
  env?: NodeJS.ProcessEnv;
  fallbackFilePath?: string;
  kernelRelease?: string;
  platform?: NodeJS.Platform;
  serviceName?: string;
}): LinearTokenStore => {
  const accountName = options?.accountName ?? DEFAULT_ACCOUNT;
  const exec = options?.exec ?? runCommand;
  const env = options?.env ?? process.env;
  const fallbackFilePath =
    options?.fallbackFilePath ?? join(homedir(), ".aop", "credentials", "linear-oauth.json");
  const kernelRelease = options?.kernelRelease ?? release();
  const platform = options?.platform ?? process.platform;
  const serviceName = options?.serviceName ?? DEFAULT_SERVICE;
  let unlockedTokens: LinearTokenSet | null = null;

  const save = async (tokens: LinearTokenSet): Promise<void> => {
    const serialized = JSON.stringify(tokens);
    try {
      const storeResult =
        platform === "darwin"
          ? await exec({
              args: [
                "sh",
                "-lc",
                `security add-generic-password -U -s '${escapeSingleQuotes(serviceName)}' -a '${escapeSingleQuotes(accountName)}' -w "$AOP_LINEAR_TOKENS"`,
              ],
              env: { AOP_LINEAR_TOKENS: serialized },
            })
          : await exec({
              args: [
                "secret-tool",
                "store",
                "--label",
                "AOP Linear OAuth",
                "service",
                serviceName,
                "account",
                accountName,
              ],
              stdin: serialized,
            });

      ensureSuccess(platform, storeResult, "Failed to store Linear OAuth credentials");
    } catch (error) {
      if (!shouldUseFileFallback(platform, env, kernelRelease, error)) {
        throw error;
      }

      await writeFallbackFile(fallbackFilePath, serialized);
    }

    unlockedTokens = tokens;
  };

  const getStatus = async (): Promise<LinearTokenStoreStatus> => {
    try {
      const fallbackSerialized = await readFallbackFile(fallbackFilePath);
      if (fallbackSerialized !== null) {
        return {
          connected: true,
          locked: false,
        };
      }

      const serialized = await lookup(platform, exec, serviceName, accountName);
      return {
        connected: serialized !== null,
        locked: serialized !== null ? unlockedTokens === null : true,
      };
    } catch {
      return {
        connected: false,
        locked: true,
      };
    }
  };

  const unlock = async (): Promise<void> => {
    const fallbackSerialized = await readFallbackFile(fallbackFilePath);
    if (fallbackSerialized !== null) {
      unlockedTokens = parseTokenSet(fallbackSerialized);
      return;
    }

    const serialized = await lookup(platform, exec, serviceName, accountName);
    if (!serialized) {
      throw new Error("Linear OAuth credentials not found");
    }

    unlockedTokens = parseTokenSet(serialized);
  };

  const read = async (): Promise<LinearTokenSet> => {
    const fallbackSerialized = await readFallbackFile(fallbackFilePath);
    if (fallbackSerialized !== null) {
      return parseTokenSet(fallbackSerialized);
    }

    if (!unlockedTokens) {
      throw new Error("Linear token store is locked");
    }
    return unlockedTokens;
  };

  const lock = async (): Promise<void> => {
    unlockedTokens = null;
  };

  const disconnect = async (): Promise<void> => {
    unlockedTokens = null;
    if (await readFallbackFile(fallbackFilePath)) {
      await rm(fallbackFilePath, { force: true });
      return;
    }

    const deleteResult =
      platform === "darwin"
        ? await exec({
            args: ["security", "delete-generic-password", "-s", serviceName, "-a", accountName],
          })
        : await exec({
            args: ["secret-tool", "clear", "service", serviceName, "account", accountName],
          });

    if (isUnavailable(platform, deleteResult)) {
      throw createUnavailableError(platform, deleteResult.stderr);
    }
  };

  return {
    save,
    getStatus,
    unlock,
    read,
    lock,
    disconnect,
  };
};

const ensureSuccess = (platform: NodeJS.Platform, result: ExecResult, message: string): void => {
  if (result.exitCode === 0) {
    return;
  }

  if (isUnavailable(platform, result)) {
    throw createUnavailableError(platform, result.stderr);
  }

  throw new Error(buildErrorMessage(message, result.stderr));
};

const lookup = async (
  platform: NodeJS.Platform,
  exec: CommandExecutor,
  serviceName: string,
  accountName: string,
): Promise<string | null> => {
  const result =
    platform === "darwin"
      ? await exec({
          args: ["security", "find-generic-password", "-w", "-s", serviceName, "-a", accountName],
        })
      : await exec({
          args: ["secret-tool", "lookup", "service", serviceName, "account", accountName],
        });

  if (result.exitCode === 0) {
    return result.stdout.trim();
  }

  if (isUnavailable(platform, result)) {
    throw createUnavailableError(platform, result.stderr);
  }

  return null;
};

const parseTokenSet = (serialized: string): LinearTokenSet => {
  const parsed = JSON.parse(serialized) as Partial<LinearTokenSet>;
  if (!parsed.accessToken || !parsed.refreshToken || !parsed.expiresAt) {
    throw new Error("Linear OAuth credentials are invalid");
  }
  return {
    accessToken: parsed.accessToken,
    refreshToken: parsed.refreshToken,
    expiresAt: parsed.expiresAt,
  };
};

const shouldUseFileFallback = (
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  kernelRelease: string,
  error: unknown,
): boolean => {
  if (platform !== "linux" || !isWsl(env, kernelRelease) || !(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return (
    message.includes("secret-tool") ||
    message.includes("secret service") ||
    message.includes("dbus") ||
    message.includes("command not found") ||
    message.includes("executable not found")
  );
};

const isWsl = (env: NodeJS.ProcessEnv, kernelRelease: string): boolean => {
  return (
    Boolean(env.WSL_DISTRO_NAME || env.WSL_INTEROP) ||
    kernelRelease.toLowerCase().includes("microsoft")
  );
};

const writeFallbackFile = async (fallbackFilePath: string, serialized: string): Promise<void> => {
  await mkdir(dirname(fallbackFilePath), { recursive: true });
  await writeFile(fallbackFilePath, serialized, "utf8");
  await chmod(fallbackFilePath, 0o600);
};

const readFallbackFile = async (fallbackFilePath: string): Promise<string | null> => {
  try {
    return await readFile(fallbackFilePath, "utf8");
  } catch {
    return null;
  }
};

const isUnavailable = (platform: NodeJS.Platform, result: ExecResult): boolean => {
  if (result.exitCode === 127) {
    return true;
  }

  const stderr = (result.stderr ?? "").toLowerCase();
  if (platform === "linux") {
    return (
      stderr.includes("command not found") ||
      stderr.includes("secret service") ||
      stderr.includes("cannot create an item") ||
      stderr.includes("dbus")
    );
  }

  return stderr.includes("command not found");
};

const createUnavailableError = (platform: NodeJS.Platform, stderr: string): Error => {
  if (platform === "linux") {
    return new Error(
      buildErrorMessage(
        "Linear secure storage is unavailable. Install `secret-tool` and ensure a Secret Service session is running.",
        stderr,
      ),
    );
  }

  return new Error(buildErrorMessage("Linear secure storage is unavailable.", stderr));
};

const buildErrorMessage = (message: string, stderr: string | undefined): string => {
  const detail = (stderr ?? "").trim();
  return detail ? `${message} ${detail}` : message;
};

const escapeSingleQuotes = (value: string): string => value.replaceAll("'", "'\\''");

const runCommand = async (invocation: ExecInvocation): Promise<ExecResult> => {
  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn(invocation.args, {
      env: {
        ...process.env,
        ...invocation.env,
      },
      stdin: invocation.stdin ? Buffer.from(invocation.stdin, "utf8") : undefined,
      stdout: "pipe",
      stderr: "pipe",
    });
  } catch (error) {
    return {
      exitCode: 127,
      stdout: "",
      stderr: error instanceof Error ? error.message : String(error),
    };
  }

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return {
    exitCode,
    stdout,
    stderr,
  };
};
