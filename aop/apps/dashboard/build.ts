#!/usr/bin/env bun
/**
 * Production build script for the dashboard.
 * Uses Bun's built-in bundler for React + TypeScript.
 * Tailwind CSS is processed via postcss.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { configureLogging, getLogger } from "@aop/infra";

const log = getLogger("build");

const DIST_DIR = "./dist";
const SRC_DIR = "./src";

async function buildCSS(): Promise<void> {
  const cssPath = `${SRC_DIR}/index.css`;

  log.info("Building CSS with Tailwind...");

  const result = await Bun.$`bunx @tailwindcss/cli -i ${cssPath} -o ${DIST_DIR}/index.css --minify`;
  if (result.exitCode !== 0) {
    log.error("Tailwind stderr: {stderr}", { stderr: result.stderr.toString() });
    log.error("Tailwind stdout: {stdout}", { stdout: result.stdout.toString() });
    throw new Error(`Tailwind build failed with exit code ${result.exitCode}`);
  }
  log.info("CSS built successfully");
}

async function buildJS(): Promise<string | undefined> {
  const result = await Bun.build({
    entrypoints: [`${SRC_DIR}/main.tsx`],
    outdir: DIST_DIR,
    target: "browser",
    format: "esm",
    minify: true,
    sourcemap: "external",
    splitting: true,
    naming: "[name]-[hash].[ext]",
    define: {
      "process.env.NODE_ENV": '"production"',
    },
  });

  if (!result.success) {
    log.error("Build failed");
    for (const buildLog of result.logs) {
      log.error("{log}", { log: String(buildLog) });
    }
    process.exit(1);
  }

  const mainOutput = result.outputs.find((o) => o.path.includes("main"));
  if (mainOutput) {
    return mainOutput.path.replace(`${process.cwd()}/dist/`, "");
  }
  return undefined;
}

async function buildHTML(jsFile?: string): Promise<void> {
  const html = readFileSync(`${SRC_DIR}/index.html`, "utf-8");

  const prodHtml = html
    .replace(
      /<script type=["']module["'] src=["']\/src\/main\.tsx["']><\/script>/,
      `<script type="module" src="/${jsFile ?? "main.js"}"></script>`,
    )
    .replace(
      /<link rel=["']stylesheet["'] href=["']\/src\/index\.css["']\s*\/?>/,
      '<link rel="stylesheet" href="/index.css" />',
    );

  writeFileSync(`${DIST_DIR}/index.html`, prodHtml);
}

async function build(): Promise<void> {
  await configureLogging({ format: "pretty", serviceName: "dashboard" });
  log.info("Building dashboard...");

  // Clean dist
  if (existsSync(DIST_DIR)) {
    rmSync(DIST_DIR, { recursive: true });
  }
  mkdirSync(DIST_DIR);

  // Build in parallel
  const [, jsResult] = await Promise.all([buildCSS(), buildJS()]);

  await buildHTML(jsResult as string | undefined);

  log.info("Dashboard built successfully!");
}

build().catch(async (err) => {
  await configureLogging({ format: "pretty", serviceName: "dashboard" });
  log.error("Build failed: {error}", { error: String(err) });
  process.exit(1);
});
