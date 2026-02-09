import { MakerDMG } from "@electron-forge/maker-dmg";
import { MakerWix } from "@electron-forge/maker-wix";
import { AutoUnpackNativesPlugin } from "@electron-forge/plugin-auto-unpack-natives";
import { WebpackPlugin } from "@electron-forge/plugin-webpack";
import type { ForgeConfig } from "@electron-forge/shared-types";
import fs from "fs";
import path from "path";
import { mainConfig } from "./webpack.main.config.js";
import { rendererConfig } from "./webpack.renderer.config.js";

const copyMainEntry = () => {
  const webpackDir = path.join(__dirname, ".webpack");
  const archDir = path.join(webpackDir, process.arch);
  const sourceFile = path.join(archDir, "main.js");
  const targetFile = path.join(webpackDir, "main");

  if (fs.existsSync(sourceFile) && !fs.existsSync(targetFile)) {
    fs.mkdirSync(webpackDir, { recursive: true });
    fs.copyFileSync(sourceFile, targetFile);
  }
};

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    extraResources: [
      {
        from: "../local-server/dist/aop-server",
        to: "aop-server",
      },
      {
        from: "../dashboard/dist",
        to: "dashboard",
      },
      {
        from: "./assets/tray-icon.png",
        to: "tray-icon.png",
      },
      {
        from: "./assets/tray-iconTemplate.png",
        to: "tray-iconTemplate.png",
      },
    ],
    icon: "./assets/icon",
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
    new AutoUnpackNativesPlugin({}),
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
    packageAfterPrune: copyMainEntry,
    prePackage: copyMainEntry,
  },
};

export default config;
