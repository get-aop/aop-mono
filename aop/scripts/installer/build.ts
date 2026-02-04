#!/usr/bin/env bun
// biome-ignore-all lint/suspicious/noConsole: CLI build script requires console output for user feedback

import { cpSync, existsSync, rmSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import cac from "cac";

const TARGETS = ["bun-linux-x64", "bun-linux-arm64", "bun-darwin-x64", "bun-darwin-arm64"] as const;

type Target = (typeof TARGETS)[number];

const RELEASE_DIR = "./dist/release";
const ENTRYPOINT = "./scripts/installer/entrypoint.ts";
const DASHBOARD_DIST = "./apps/dashboard/dist";

const targetToFilename = (target: Target): string => {
  const [, os, arch] = target.split("-");
  return `aop-${os}-${arch}`;
};

const getBuildVersion = async (): Promise<string> => {
  const pkg = await Bun.file("./package.json").json();
  const commit = (await Bun.$`git rev-parse --short HEAD`.text()).trim();
  return `${pkg.version}+${commit}`;
};

const buildDashboard = async (): Promise<void> => {
  console.log("Building dashboard...");
  const result = await Bun.$`bun run --filter @aop/dashboard build`.quiet();
  if (result.exitCode !== 0) {
    console.error(result.stderr.toString());
    throw new Error("Dashboard build failed");
  }

  if (!existsSync(join(DASHBOARD_DIST, "index.html"))) {
    throw new Error("Dashboard build succeeded but dist/index.html not found");
  }
  console.log("Dashboard built successfully");
};

const buildTarget = async (target: Target, version: string): Promise<string> => {
  const filename = targetToFilename(target);
  const outfile = join(RELEASE_DIR, filename);
  console.log(`Building ${filename}...`);

  const result = await Bun.build({
    entrypoints: [ENTRYPOINT],
    compile: {
      target,
      outfile,
    },
    minify: true,
    define: {
      BUILD_VERSION: JSON.stringify(version),
    },
  });

  if (!result.success) {
    for (const log of result.logs) {
      console.error(String(log));
    }
    throw new Error(`Build failed for ${target}`);
  }

  // Copy dashboard assets alongside the binary
  const dashboardOut = join(RELEASE_DIR, "dashboard");
  if (!existsSync(dashboardOut)) {
    cpSync(DASHBOARD_DIST, dashboardOut, { recursive: true });
  }

  console.log(`Built ${filename}`);
  return outfile;
};

const generateChecksums = async (files: string[]): Promise<void> => {
  const lines: string[] = [];

  for (const filepath of files) {
    const data = await Bun.file(filepath).arrayBuffer();
    const hasher = new Bun.CryptoHasher("sha256");
    hasher.update(data);
    const hash = hasher.digest("hex");
    const filename = filepath.split("/").pop();
    lines.push(`${hash}  ${filename}`);
  }

  const checksumPath = join(RELEASE_DIR, "checksums.sha256");
  await Bun.write(checksumPath, `${lines.join("\n")}\n`);
  console.log("Generated checksums.sha256");
};

const main = async (): Promise<void> => {
  const cli = cac("build");
  cli.option("--target <target>", "Build only a single platform target");
  const { options } = cli.parse();

  const targetFilter = options.target as string | undefined;
  const targets = targetFilter ? TARGETS.filter((t) => t.endsWith(targetFilter)) : [...TARGETS];

  if (targets.length === 0) {
    console.error(
      `Unknown target: ${targetFilter}. Valid: ${TARGETS.map((t) => t.replace("bun-", "")).join(
        ", ",
      )}`,
    );
    process.exit(1);
  }

  if (existsSync(RELEASE_DIR)) {
    rmSync(RELEASE_DIR, { recursive: true });
  }
  await mkdir(RELEASE_DIR, { recursive: true });

  await buildDashboard();

  const version = await getBuildVersion();
  console.log(`Version: ${version}`);

  const outputs: string[] = [];
  for (const target of targets) {
    const outfile = await buildTarget(target, version);
    outputs.push(outfile);
  }

  await generateChecksums(outputs);

  console.log(`\nBuild complete! ${outputs.length} binaries in ${RELEASE_DIR}/`);
};

main().catch((err) => {
  console.error("Build failed:", err);
  process.exit(1);
});
