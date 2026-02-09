import { MakerDMG } from "@electron-forge/maker-dmg";
import { MakerWix } from "@electron-forge/maker-wix";
import { WebpackPlugin } from "@electron-forge/plugin-webpack";
import type { ForgeConfig } from "@electron-forge/shared-types";
import path from "path";
import { mainConfig } from "./webpack.main.config.js";
import { rendererConfig } from "./webpack.renderer.config.js";

const config: ForgeConfig = {
  packagerConfig: {
    asar: false,
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

};

export default config;
