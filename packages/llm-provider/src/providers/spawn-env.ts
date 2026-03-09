import { homedir } from "node:os";
import { delimiter } from "node:path";

const buildFallbackPaths = (): string[] => {
  const home = homedir();
  return [
    "/usr/local/bin",
    "/opt/homebrew/bin",
    `${home}/.local/bin`,
    `${home}/.opencode/bin`,
    `${home}/.bun/bin`,
    `${home}/bin`,
  ];
};

const mergePath = (rawPath: string | undefined): string => {
  const parts = (rawPath ?? "").split(delimiter).filter(Boolean);

  for (const candidate of buildFallbackPaths()) {
    if (!parts.includes(candidate)) {
      parts.push(candidate);
    }
  }

  return parts.join(delimiter);
};

export const buildSpawnEnv = (extraEnv?: Record<string, string>): Record<string, string> => {
  const mergedEnv = {
    ...process.env,
    ...(extraEnv ?? {}),
  } as Record<string, string>;

  mergedEnv.PATH = mergePath(mergedEnv.PATH);
  return mergedEnv;
};
