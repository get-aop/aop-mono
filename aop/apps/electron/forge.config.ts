import fs from "node:fs";
import path from "node:path";
import { MakerDeb } from "@electron-forge/maker-deb";
import { MakerDMG } from "@electron-forge/maker-dmg";
import { WebpackPlugin } from "@electron-forge/plugin-webpack";
import type { ForgeConfig } from "@electron-forge/shared-types";
import { mainConfig } from "./webpack.main.config.js";
import { rendererConfig } from "./webpack.renderer.config.js";

interface BuildResult {
  outputPaths?: string[];
}

const copyExtraResourcesMac = async (outputPath: string) => {
  const resourcesDir = path.join(outputPath, "AOP.app", "Contents", "Resources");

  if (!fs.existsSync(resourcesDir)) {
    // biome-ignore lint/suspicious/noConsole: build logging
    console.log(`[Forge] macOS resources not found at ${resourcesDir}`);
    return;
  }

  // biome-ignore lint/suspicious/noConsole: build logging
  console.log(`[Forge] macOS resources: ${resourcesDir}`);

  const iconSource = path.join(__dirname, "assets", "icon.icns");
  const electronIconTarget = path.join(resourcesDir, "electron.icns");
  if (fs.existsSync(iconSource)) {
    fs.cpSync(iconSource, electronIconTarget, { force: true });
    // biome-ignore lint/suspicious/noConsole: build logging
    console.log(`[Forge] Replaced icon: ${iconSource} -> ${electronIconTarget}`);
  }

  const filesToCopy = [
    {
      from: path.join(__dirname, "..", "local-server", "dist", "aop-server"),
      to: path.join(resourcesDir, "aop-server"),
    },
    {
      from: path.join(__dirname, "..", "dashboard", "dist"),
      to: path.join(resourcesDir, "dashboard"),
    },
    {
      from: path.join(__dirname, "assets", "tray-icon.png"),
      to: path.join(resourcesDir, "tray-icon.png"),
    },
    {
      from: path.join(__dirname, "assets", "tray-iconTemplate.png"),
      to: path.join(resourcesDir, "tray-iconTemplate.png"),
    },
  ];

  for (const { from, to } of filesToCopy) {
    if (fs.existsSync(from)) {
      fs.cpSync(from, to, { recursive: true, force: true });
      // biome-ignore lint/suspicious/noConsole: build logging
      console.log(`[Forge] Copied ${from} -> ${to}`);
    } else {
      // biome-ignore lint/suspicious/noConsole: build logging
      console.error(`[Forge] Source not found: ${from}`);
    }
  }
};

const copyExtraResourcesLinux = async (outputPath: string) => {
  const resourcesDir = outputPath;

  if (!fs.existsSync(resourcesDir)) {
    // biome-ignore lint/suspicious/noConsole: build logging
    console.log(`[Forge] Linux output not found at ${resourcesDir}`);
    return;
  }

  // biome-ignore lint/suspicious/noConsole: build logging
  console.log(`[Forge] Linux resources: ${resourcesDir}`);

  const filesToCopy = [
    {
      from: path.join(__dirname, "..", "local-server", "dist", "aop-server"),
      to: path.join(resourcesDir, "aop-server"),
    },
    {
      from: path.join(__dirname, "..", "dashboard", "dist"),
      to: path.join(resourcesDir, "dashboard"),
    },
    {
      from: path.join(__dirname, "assets", "tray-icon.png"),
      to: path.join(resourcesDir, "tray-icon.png"),
    },
    {
      from: path.join(__dirname, "assets", "tray-iconTemplate.png"),
      to: path.join(resourcesDir, "tray-iconTemplate.png"),
    },
  ];

  for (const { from, to } of filesToCopy) {
    if (fs.existsSync(from)) {
      fs.cpSync(from, to, { recursive: true, force: true });
      // biome-ignore lint/suspicious/noConsole: build logging
      console.log(`[Forge] Copied ${from} -> ${to}`);
    } else {
      // biome-ignore lint/suspicious/noConsole: build logging
      console.error(`[Forge] Source not found: ${from}`);
    }
  }
};

const copyExtraResources = async (_config: ForgeConfig, buildResult: BuildResult) => {
  const outputPath = buildResult?.outputPaths?.[0];
  if (!outputPath) {
    // biome-ignore lint/suspicious/noConsole: build logging
    console.log("[Forge] No output path found");
    return;
  }

  if (outputPath.includes("darwin") || outputPath.includes("AOP.app")) {
    await copyExtraResourcesMac(outputPath);
  } else {
    await copyExtraResourcesLinux(outputPath);
  }
};

const config: ForgeConfig = {
  packagerConfig: {
    asar: false,
    executableName: "aop",
    extraResources: [
      {
        from: path.join(__dirname, "..", "local-server", "dist", "aop-server"),
        to: "aop-server",
      },
      {
        from: path.join(__dirname, "..", "dashboard", "dist"),
        to: "dashboard",
      },
      {
        from: path.join(__dirname, "assets", "tray-icon.png"),
        to: "tray-icon.png",
      },
      {
        from: path.join(__dirname, "assets", "tray-iconTemplate.png"),
        to: "tray-iconTemplate.png",
      },
    ],
    icon: path.join(__dirname, "assets", "icon"),
  },
  rebuildConfig: {},
  makers: [
    new MakerDMG({
      name: "aop-desktop",
      icon: "./assets/icon.icns",
      overwrite: true,
    }),
    new MakerDeb({
      options: {
        maintainer: "AOP Team",
        homepage: "https://github.com/get-aop/aop-mono",
        icon: path.join(__dirname, "assets", "icon.png"),
        categories: ["Development", "Utility"],
        description: "AOP Desktop Application - Run agents on your repos",
        productName: "aop",
        bin: "aop",
      },
    }),
  ],
  plugins: [
    new WebpackPlugin({
      mainConfig,
      renderer: {
        config: rendererConfig,
        entryPoints: [
          {
            html: "./src/index.html",
            js: "./src/renderer.ts",
            name: "main_window",
            preload: {
              js: "./src/preload.ts",
            },
          },
        ],
      },
    }),
  ],
  hooks: {
    postPackage: copyExtraResources,
  },
};

export default config;
