import { MakerDMG } from "@electron-forge/maker-dmg";
import { MakerWix } from "@electron-forge/maker-wix";
import { WebpackPlugin } from "@electron-forge/plugin-webpack";
import type { ForgeConfig } from "@electron-forge/shared-types";
import fs from "fs";
import path from "path";
import { mainConfig } from "./webpack.main.config.js";
import { rendererConfig } from "./webpack.renderer.config.js";

// Copy extra resources after packaging
const copyExtraResources = async (_config: any, buildResult: any) => {
  // Get the output path from buildResult
  const outputPath = buildResult?.outputPaths?.[0];
  if (!outputPath) {
    console.log("[Forge] No output path found");
    return;
  }
  
  // Construct the Resources path
  const resourcesDir = path.join(outputPath, "AOP.app", "Contents", "Resources");
  
  if (!fs.existsSync(resourcesDir)) {
    console.log(`[Forge] Resources directory not found at ${resourcesDir}`);
    return;
  }
  
  console.log(`[Forge] Resources directory: ${resourcesDir}`);
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
      console.log(`[Forge] Copied ${from} -> ${to}`);
    } else {
      console.error(`[Forge] Source not found: ${from}`);
    }
  }
};

const config: ForgeConfig = {
  packagerConfig: {
    asar: false,
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
      name: "AOP Desktop",
      icon: "./assets/icon.icns",
      overwrite: true,
    }),
    new MakerWix({
      name: "AOP Desktop",
      manufacturer: "AOP",
      description: "AOP Desktop Application",
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
