/* biome-ignore-all lint/suspicious/noConsole: Electron Forge build script */
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
    console.log(`[Forge] macOS resources not found at ${resourcesDir}`);
    return;
  }

  console.log(`[Forge] macOS resources: ${resourcesDir}`);

  const iconSource = path.join(__dirname, "assets", "icon.icns");
  const electronIconTarget = path.join(resourcesDir, "electron.icns");
  if (fs.existsSync(iconSource)) {
    fs.cpSync(iconSource, electronIconTarget, { force: true });
    console.log(`[Forge] Replaced icon: ${iconSource} -> ${electronIconTarget}`);
  }

  const skillsSource = path.join(__dirname, "..", "..", "..", ".claude", "skills");
  const codexSource = path.join(__dirname, "..", "..", "..", ".codex");
  const filesToCopy = [
    {
      from: path.join(__dirname, "..", "local-server", "dist", "aop-server"),
      to: path.join(resourcesDir, "aop-server"),
    },
    {
      from: path.join(__dirname, "..", "dashboard", "dist"),
      to: path.join(resourcesDir, "dashboard"),
    },
    ...(fs.existsSync(skillsSource)
      ? [{ from: skillsSource, to: path.join(resourcesDir, "claude-skills") }]
      : []),
    ...(fs.existsSync(codexSource)
      ? [{ from: codexSource, to: path.join(resourcesDir, "codex") }]
      : []),
    {
      from: path.join(__dirname, "assets", "tray-icon.png"),
      to: path.join(resourcesDir, "tray-icon.png"),
    },
    {
      from: path.join(__dirname, "assets", "tray-iconTemplate.png"),
      to: path.join(resourcesDir, "tray-iconTemplate.png"),
    },
    {
      from: path.join(__dirname, "assets", "tray-iconTemplate@2x.png"),
      to: path.join(resourcesDir, "tray-iconTemplate@2x.png"),
    },
    {
      from: path.join(__dirname, "assets", "icon.png"),
      to: path.join(resourcesDir, "icon.png"),
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

const copyExtraResourcesLinux = async (outputPath: string) => {
  const resourcesDir = path.join(outputPath, "resources");

  if (!fs.existsSync(resourcesDir)) {
    console.log(`[Forge] Creating resources directory at ${resourcesDir}`);
    fs.mkdirSync(resourcesDir, { recursive: true });
  }

  console.log(`[Forge] Linux resources: ${resourcesDir}`);

  const skillsSource = path.join(__dirname, "..", "..", "..", ".claude", "skills");
  const codexSource = path.join(__dirname, "..", "..", "..", ".codex");
  const filesToCopy = [
    {
      from: path.join(__dirname, "..", "local-server", "dist", "aop-server"),
      to: path.join(resourcesDir, "aop-server"),
    },
    {
      from: path.join(__dirname, "..", "dashboard", "dist"),
      to: path.join(resourcesDir, "dashboard"),
    },
    ...(fs.existsSync(skillsSource)
      ? [{ from: skillsSource, to: path.join(resourcesDir, "claude-skills") }]
      : []),
    ...(fs.existsSync(codexSource)
      ? [{ from: codexSource, to: path.join(resourcesDir, "codex") }]
      : []),
    {
      from: path.join(__dirname, "assets", "tray-icon.png"),
      to: path.join(resourcesDir, "tray-icon.png"),
    },
    {
      from: path.join(__dirname, "assets", "tray-iconTemplate.png"),
      to: path.join(resourcesDir, "tray-iconTemplate.png"),
    },
    {
      from: path.join(__dirname, "assets", "tray-iconTemplate@2x.png"),
      to: path.join(resourcesDir, "tray-iconTemplate@2x.png"),
    },
    {
      from: path.join(__dirname, "assets", "icon.png"),
      to: path.join(resourcesDir, "icon.png"),
    },
  ];

  const launcherFrom = path.join(__dirname, "scripts", "launch.sh");
  const launcherTo = path.join(outputPath, "launch.sh");
  if (fs.existsSync(launcherFrom)) {
    fs.cpSync(launcherFrom, launcherTo, { force: true });
    fs.chmodSync(launcherTo, 0o755);
    console.log(`[Forge] Copied launcher ${launcherFrom} -> ${launcherTo}`);
  }

  for (const { from, to } of filesToCopy) {
    if (fs.existsSync(from)) {
      fs.cpSync(from, to, { recursive: true, force: true });
      console.log(`[Forge] Copied ${from} -> ${to}`);
    } else {
      console.error(`[Forge] Source not found: ${from}`);
    }
  }
};

const copyExtraResourcesWindows = async (outputPath: string) => {
  const resourcesDir = path.join(outputPath, "resources");

  if (!fs.existsSync(resourcesDir)) {
    console.log(`[Forge] Creating resources directory at ${resourcesDir}`);
    fs.mkdirSync(resourcesDir, { recursive: true });
  }

  console.log(`[Forge] Windows resources: ${resourcesDir}`);

  const skillsSource = path.join(__dirname, "..", "..", "..", ".claude", "skills");
  const codexSource = path.join(__dirname, "..", "..", "..", ".codex");
  const filesToCopy = [
    {
      from: path.join(__dirname, "..", "local-server", "dist", "aop-server-linux"),
      to: path.join(resourcesDir, "aop-server-linux"),
    },
    {
      from: path.join(__dirname, "..", "dashboard", "dist"),
      to: path.join(resourcesDir, "dashboard"),
    },
    ...(fs.existsSync(skillsSource)
      ? [{ from: skillsSource, to: path.join(resourcesDir, "claude-skills") }]
      : []),
    ...(fs.existsSync(codexSource)
      ? [{ from: codexSource, to: path.join(resourcesDir, "codex") }]
      : []),
    {
      from: path.join(__dirname, "assets", "tray-icon.png"),
      to: path.join(resourcesDir, "tray-icon.png"),
    },
    {
      from: path.join(__dirname, "assets", "tray-iconTemplate.png"),
      to: path.join(resourcesDir, "tray-iconTemplate.png"),
    },
    {
      from: path.join(__dirname, "assets", "tray-iconTemplate@2x.png"),
      to: path.join(resourcesDir, "tray-iconTemplate@2x.png"),
    },
    {
      from: path.join(__dirname, "assets", "icon.png"),
      to: path.join(resourcesDir, "icon.png"),
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

const copyExtraResources = async (_config: ForgeConfig, buildResult: BuildResult) => {
  const outputPath = buildResult?.outputPaths?.[0];
  if (!outputPath) {
    console.log("[Forge] No output path found");
    return;
  }

  if (outputPath.includes("darwin") || outputPath.includes("AOP.app")) {
    await copyExtraResourcesMac(outputPath);
  } else if (
    outputPath.includes("win32") ||
    outputPath.includes("nsis") ||
    outputPath.includes("squirrel.windows")
  ) {
    await copyExtraResourcesWindows(outputPath);
  } else {
    await copyExtraResourcesLinux(outputPath);
  }
};

const config: ForgeConfig = {
  packagerConfig: {
    asar: false,
    executableName: "aop",
    extraResources: [
      process.platform === "win32"
        ? {
            from: path.join(__dirname, "..", "local-server", "dist", "aop-server-linux"),
            to: "aop-server-linux",
          }
        : {
            from: path.join(__dirname, "..", "local-server", "dist", "aop-server"),
            to: "aop-server",
          },
      {
        from: path.join(__dirname, "..", "dashboard", "dist"),
        to: "dashboard",
      },
      ...(fs.existsSync(path.join(__dirname, "..", "..", "..", ".claude", "skills"))
        ? [
            {
              from: path.join(__dirname, "..", "..", "..", ".claude", "skills"),
              to: "claude-skills",
            },
          ]
        : []),
      ...(fs.existsSync(path.join(__dirname, "..", "..", "..", ".codex"))
        ? [
            {
              from: path.join(__dirname, "..", "..", "..", ".codex"),
              to: "codex",
            },
          ]
        : []),
      {
        from: path.join(__dirname, "assets", "tray-icon.png"),
        to: "tray-icon.png",
      },
      {
        from: path.join(__dirname, "assets", "tray-iconTemplate.png"),
        to: "tray-iconTemplate.png",
      },
      {
        from: path.join(__dirname, "assets", "tray-iconTemplate@2x.png"),
        to: "tray-iconTemplate@2x.png",
      },
      {
        from: path.join(__dirname, "assets", "icon.png"),
        to: "icon.png",
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
        name: "aop",
        maintainer: "AOP Team",
        homepage: "https://github.com/get-aop/aop-mono",
        icon: path.join(__dirname, "assets", "icon.png"),
        categories: ["Development", "Utility"],
        description: "AOP Desktop Application - Run agents on your repos",
        productName: "aop",
        bin: "aop",
        depends: ["libnss3", "libnspr4", "libasound2t64 | libasound2"],
      },
    }),
    ...(process.platform === "win32"
      ? [{ name: "@electron-addons/electron-forge-maker-nsis", config: {} }]
      : []),
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
