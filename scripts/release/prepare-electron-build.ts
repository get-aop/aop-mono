#!/usr/bin/env bun
/* biome-ignore-all lint/suspicious/noConsole: release script emits CI diagnostics */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { normalizeReleaseVersion } from "./versioning";

const PACKAGE_FILES = [
  "package.json",
  "apps/electron/package.json",
  "apps/dashboard/package.json",
  "apps/local-server/package.json",
  "apps/cli/package.json",
];

const BUILD_OUTPUT_DIRS = [
  "apps/electron/out",
  "apps/electron/.webpack",
  "apps/dashboard/dist",
  "apps/local-server/dist",
];

const CACHE_ENV_VARS = ["ELECTRON_CACHE", "ELECTRON_BUILDER_CACHE"] as const;

type PackageJson = {
  version?: string;
} & Record<string, unknown>;

const readVersionArg = (): string | null => {
  const versionIndex = process.argv.indexOf("--version");
  if (versionIndex >= 0) {
    return process.argv[versionIndex + 1] ?? null;
  }
  return process.env.RELEASE_VERSION ?? null;
};

const updatePackageVersion = (pathFromRepoRoot: string, version: string): void => {
  const absolutePath = resolve(process.cwd(), pathFromRepoRoot);
  const json = JSON.parse(readFileSync(absolutePath, "utf8")) as PackageJson;
  if (json.version === version) {
    return;
  }

  json.version = version;
  writeFileSync(absolutePath, `${JSON.stringify(json, null, 2)}\n`);
  console.log(`[release] Updated ${pathFromRepoRoot} -> ${version}`);
};

const cleanDirectory = (pathFromRepoRoot: string): void => {
  const absolutePath = resolve(process.cwd(), pathFromRepoRoot);
  rmSync(absolutePath, { recursive: true, force: true });
  console.log(`[release] Cleaned ${pathFromRepoRoot}`);
};

const resetCacheDir = (cachePath: string): void => {
  rmSync(cachePath, { recursive: true, force: true });
  mkdirSync(cachePath, { recursive: true });
  console.log(`[release] Reset cache ${cachePath}`);
};

/* biome-ignore lint/complexity/noExcessiveCognitiveComplexity: linear CI preparation script */
const main = (): void => {
  const rawVersion = readVersionArg();
  if (rawVersion) {
    const version = normalizeReleaseVersion(rawVersion);
    console.log(`[release] Preparing Electron build for version ${version}`);

    for (const packageFile of PACKAGE_FILES) {
      updatePackageVersion(packageFile, version);
    }
  } else {
    console.log("[release] No release version provided; skipping package version updates");
  }

  for (const outputDir of BUILD_OUTPUT_DIRS) {
    cleanDirectory(outputDir);
  }

  for (const cacheVar of CACHE_ENV_VARS) {
    const cachePath = process.env[cacheVar];
    if (cachePath && existsSync(resolve(cachePath))) {
      resetCacheDir(cachePath);
    } else if (cachePath) {
      mkdirSync(cachePath, { recursive: true });
      console.log(`[release] Initialized cache ${cachePath}`);
    }
  }
};

main();
