/* biome-ignore-all lint/suspicious/noConsole: Electron main process - no infra logger */
import { type ChildProcess, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { app, BrowserWindow, dialog, ipcMain } from "electron";
import {
  createTray,
  destroyTray,
  getAssetPath,
  setCheckForUpdatesFn,
  setIsQuitting,
  setMainWindow,
} from "./tray.js";
import { initAutoUpdater } from "./updater.js";
import {
  getDefaultDistro,
  isWslAvailable,
  showNoDistroDialog,
  showWslMissingPackagesDialog,
  showWslNotInstalledDialog,
  spawnInWsl,
  syncResourcesToWsl,
} from "./wsl.js";

if (process.platform === "linux" && (process.env.WSL_DISTRO_NAME || process.env.WSLENV)) {
  app.disableHardwareAcceleration();
}

app.setName("AOP");
app.setAppUserModelId("com.aop.desktop");

let serverProcess: ChildProcess | null = null;
let mainWindow: BrowserWindow | null = null;
let _serverPort: number | null = null;
let _wslDistro: string | null = null;
const FORCE_KILL_TIMEOUT_MS = 10000;
const isWindows = process.platform === "win32";

const getServerPath = (): string => {
  const binaryName = isWindows ? "aop-server-linux" : "aop-server";
  if (app.isPackaged) {
    return path.join(process.resourcesPath, binaryName);
  }
  return path.join(__dirname, "..", "..", "local-server", "dist", binaryName);
};

const getDashboardPath = (): string => {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "dashboard");
  }
  return path.join(__dirname, "..", "..", "dashboard", "dist");
};

const getBundledResourcePath = (
  packagedDir: string,
  ...devRelPath: string[]
): string | undefined => {
  const p = app.isPackaged
    ? path.join(process.resourcesPath, packagedDir)
    : path.join(__dirname, "..", "..", "..", ...devRelPath);
  return fs.existsSync(p) ? p : undefined;
};

const spawnServerWithEnv = (
  serverPath: string,
  dashboardPath: string,
  dashboardUrl: string,
): ChildProcess => {
  return spawn(serverPath, [], {
    env: {
      ...process.env,
      AOP_ELECTRON_SIDECAR: "1",
      AOP_DB_PATH: path.join(app.getPath("userData"), "aop.db"),
      DASHBOARD_STATIC_PATH: dashboardPath,
      AOP_DASHBOARD_URL: dashboardUrl,
    },
    detached: false,
  });
};

const spawnServerNative = (): Promise<number> => {
  return new Promise((resolve, reject) => {
    const serverPath = getServerPath();
    const dashboardPath = getDashboardPath();

    let discoveryProcess: ChildProcess | null = null;
    let portFound = false;

    discoveryProcess = spawnServerWithEnv(serverPath, dashboardPath, "http://127.0.0.1:3847");

    const cleanupDiscovery = () => {
      if (discoveryProcess && !discoveryProcess.killed) {
        discoveryProcess.kill("SIGKILL");
      }
    };

    discoveryProcess.stdout?.on("data", (data: Buffer) => {
      const output = data.toString();

      const portMatch = output.match(/AOP_SERVER_PORT=(\d+)/);
      if (portMatch && !portFound) {
        portFound = true;
        const discoveredPort = parseInt(portMatch[1], 10);

        cleanupDiscovery();

        const dashboardUrl = `http://127.0.0.1:${discoveredPort}`;
        serverProcess = spawnServerWithEnv(serverPath, dashboardPath, dashboardUrl);
        _serverPort = discoveredPort;

        // Keep stdout drained in sidecar mode to avoid pipe backpressure freezing the server.
        serverProcess.stdout?.on("data", (_data: Buffer) => {});

        serverProcess.stderr?.on("data", (data: Buffer) => {
          console.error("Server stderr:", data.toString());
        });

        serverProcess.on("error", (err) => {
          console.error("Server error:", err);
          if (mainWindow) {
            mainWindow.webContents.send("server-error", String(err));
          }
        });

        serverProcess.on("exit", (code) => {
          if (code !== 0 && mainWindow) {
            mainWindow.webContents.send("server-crashed", code);
          }
          serverProcess = null;
        });

        resolve(discoveredPort);
      }

      const errorMatch = output.match(/AOP_SERVER_ERROR=(.+)/);
      if (errorMatch && !portFound) {
        cleanupDiscovery();
        reject(new Error(errorMatch[1]));
      }
    });

    discoveryProcess.stderr?.on("data", (data: Buffer) => {
      console.error("Discovery stderr:", data.toString());
    });

    discoveryProcess.on("error", (err) => {
      if (!portFound) {
        cleanupDiscovery();
        reject(err);
      }
    });

    discoveryProcess.on("exit", (code) => {
      if (!portFound) {
        reject(new Error(`Server discovery exited with code ${code}`));
      }
    });

    setTimeout(() => {
      if (!portFound) {
        cleanupDiscovery();
        reject(new Error("Timeout waiting for server port discovery"));
      }
    }, 10000);
  });
};

const buildDiscoveryErrorMsg = (
  code: number | null,
  stderr: string,
  serverBinary: string,
  distro: string,
): string => {
  let errorMsg = `Server discovery exited with code ${code}`;
  if (stderr) {
    errorMsg += `\nStderr: ${stderr}`;
  }
  if (code === 127) {
    errorMsg += `\n\nExit code 127 usually means the binary is not found or not executable.`;
    errorMsg += `\nPlease check if the server binary exists at: ${serverBinary}`;

    if (stderr.includes("not found")) {
      errorMsg += `\n\nThis typically means your WSL is missing base system libraries.`;
      errorMsg += `\nPlease install them by running in PowerShell:\n`;
      errorMsg += `wsl -d ${distro} -e sh -c "apt-get update && apt-get install -y libc6"`;
      showWslMissingPackagesDialog(distro);
    }
  }
  return errorMsg;
};

const spawnServerWindows = async (): Promise<number> => {
  mainWindow?.webContents.send("status-update", "Checking WSL...");
  const wslAvailable = await isWslAvailable();

  if (!wslAvailable) {
    showWslNotInstalledDialog();
    throw new Error("WSL not installed");
  }

  mainWindow?.webContents.send("status-update", "Finding WSL distribution...");
  const distro = await getDefaultDistro();

  if (!distro) {
    showNoDistroDialog();
    throw new Error("No WSL distribution found");
  }

  _wslDistro = distro;

  mainWindow?.webContents.send("status-update", "Copying resources to WSL...");
  const serverPath = getServerPath();
  const dashboardPath = getDashboardPath();

  if (!fs.existsSync(serverPath)) {
    throw new Error(`Server binary not found at: ${serverPath}`);
  }
  if (!fs.existsSync(dashboardPath)) {
    throw new Error(`Dashboard not found at: ${dashboardPath}`);
  }

  const wslPaths = await syncResourcesToWsl(distro, serverPath, dashboardPath);

  mainWindow?.webContents.send("status-update", "Starting AOP Server in WSL...");

  return new Promise((resolve, reject) => {
    let discoveryProcess: ChildProcess | null = null;
    let portFound = false;
    let allStderr = "";

    discoveryProcess = spawnInWsl(distro, wslPaths.serverBinary, {
      AOP_ELECTRON_SIDECAR: "1",
      AOP_DB_PATH: wslPaths.dbPath,
      DASHBOARD_STATIC_PATH: wslPaths.dashboardStatic,
      AOP_DASHBOARD_URL: "http://127.0.0.1:3847", // Dummy for discovery
    });

    const cleanupDiscovery = () => {
      if (discoveryProcess && !discoveryProcess.killed) {
        discoveryProcess.kill("SIGKILL");
      }
    };

    discoveryProcess.stdout?.on("data", (data: Buffer) => {
      const output = data.toString();

      const portMatch = output.match(/AOP_SERVER_PORT=(\d+)/);
      if (portMatch && !portFound) {
        portFound = true;
        const discoveredPort = parseInt(portMatch[1], 10);

        cleanupDiscovery();

        const dashboardUrl = `http://127.0.0.1:${discoveredPort}`;

        serverProcess = spawnInWsl(distro, wslPaths.serverBinary, {
          AOP_ELECTRON_SIDECAR: "1",
          AOP_DB_PATH: wslPaths.dbPath,
          DASHBOARD_STATIC_PATH: wslPaths.dashboardStatic,
          AOP_DASHBOARD_URL: dashboardUrl,
        });
        _serverPort = discoveredPort;

        // Keep stdout drained in sidecar mode to avoid pipe backpressure freezing the server.
        serverProcess.stdout?.on("data", (_data: Buffer) => {});

        serverProcess.stderr?.on("data", (data: Buffer) => {
          console.error("[Electron/Windows] Server stderr:", data.toString());
        });

        serverProcess.on("error", (err) => {
          console.error("[Electron/Windows] Server error:", err);
          if (mainWindow) {
            mainWindow.webContents.send("server-error", String(err));
          }
        });

        serverProcess.on("exit", (code) => {
          if (code !== 0 && mainWindow) {
            mainWindow.webContents.send("server-crashed", code);
          }
          serverProcess = null;
        });

        resolve(discoveredPort);
      }

      const errorMatch = output.match(/AOP_SERVER_ERROR=(.+)/);
      if (errorMatch && !portFound) {
        cleanupDiscovery();
        reject(new Error(errorMatch[1]));
      }
    });

    discoveryProcess.stderr?.on("data", (data: Buffer) => {
      const stderr = data.toString();
      allStderr += stderr;
      console.error("[Electron/Windows] Discovery stderr:", stderr);
    });

    discoveryProcess.on("error", (err) => {
      if (!portFound) {
        cleanupDiscovery();
        reject(err);
      }
    });

    discoveryProcess.on("exit", (code) => {
      if (!portFound) {
        const errorMsg = buildDiscoveryErrorMsg(code, allStderr, wslPaths.serverBinary, distro);
        reject(new Error(errorMsg));
      }
    });

    setTimeout(() => {
      if (!portFound) {
        cleanupDiscovery();
        reject(new Error("Timeout waiting for server port discovery"));
      }
    }, 30000);
  });
};

const spawnServer = (): Promise<number> => {
  return isWindows ? spawnServerWindows() : spawnServerNative();
};

const stopServer = async (): Promise<void> => {
  if (!serverProcess) return;

  return new Promise((resolve) => {
    const proc = serverProcess;
    if (!proc) {
      resolve();
      return;
    }

    if (isWindows && _wslDistro && proc.pid) {
      proc.kill("SIGKILL");
      serverProcess = null;
      resolve();
      return;
    }

    proc.kill("SIGTERM");

    const forceKillTimer = setTimeout(() => {
      if (!proc.killed) {
        proc.kill("SIGKILL");
      }
    }, FORCE_KILL_TIMEOUT_MS);

    proc.on("exit", () => {
      clearTimeout(forceKillTimer);
      serverProcess = null;
      resolve();
    });

    if (proc.killed) {
      clearTimeout(forceKillTimer);
      serverProcess = null;
      resolve();
    }
  });
};

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: "AOP Desktop",
    frame: false,
    ...(process.platform === "darwin"
      ? {
          titleBarStyle: "hidden" as const,
          roundedCorners: true,
          vibrancy: "sidebar" as const,
          visualEffectState: "active" as const,
          backgroundColor: "#00000000",
        }
      : {
          // Opaque background on Linux/Windows — transparent bg causes click offset bug
          backgroundColor: "#0a0a0b",
        }),
    icon: getAssetPath("icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "renderer", "main_window", "preload.js"),
      // Enable smooth scrolling and modern features
      scrollBounce: true,
    },
  });

  setMainWindow(mainWindow);

  const indexPath = app.isPackaged
    ? path.join(__dirname, "renderer", "main_window", "index.html")
    : path.join(__dirname, "..", "src", "index.html");
  mainWindow.loadFile(indexPath);

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  mainWindow.on("close", () => {
    setIsQuitting(true);
    app.quit();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  mainWindow.webContents.on("before-input-event", (_event, input) => {
    if (input.key === "F12" || (input.control && input.shift && input.key === "I")) {
      mainWindow?.webContents.toggleDevTools();
    }
  });
};

const waitForServer = async (port: number, maxRetries = 30): Promise<boolean> => {
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(url);
      if (response.status === 200) {
        return true;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
};

const loadDashboard = async (port: number) => {
  if (!mainWindow) return;

  const isReady = await waitForServer(port);

  if (!isReady) {
    console.error(`[Electron] Server on port ${port} failed to respond`);
    mainWindow.webContents.send("server-error", "Server failed to start");
    return;
  }

  mainWindow.loadURL(`http://127.0.0.1:${port}`);
  mainWindow.setTitle("AOP Desktop");
  mainWindow.show();
};

const restartServer = async () => {
  if (serverProcess) {
    await stopServer();
  }

  try {
    const port = await spawnServer();
    loadDashboard(port);
    if (mainWindow) {
      mainWindow.webContents.send("server-restarted");
    }
  } catch (err) {
    console.error("Failed to restart server:", err);
    if (mainWindow) {
      mainWindow.webContents.send("server-error", String(err));
    }
  }
};

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    createWindow();

    createTray();

    if (mainWindow) {
      const updater = initAutoUpdater(mainWindow);
      setCheckForUpdatesFn(() => updater.checkForUpdates());
    }

    try {
      const port = await spawnServer();
      loadDashboard(port);
    } catch (err) {
      const errorMsg = String(err);
      console.error("Failed to start server:", errorMsg);

      if (errorMsg.includes("No available ports") || errorMsg.includes("Timeout waiting")) {
        dialog.showErrorBox(
          "AOP Desktop Error",
          `Failed to start the AOP server.\n\n${errorMsg}\n\nPlease ensure no other applications are using ports 3847-3899 and try again.`,
        );
        app.quit();
        return;
      }

      if (mainWindow) {
        mainWindow.webContents.send("server-error", errorMsg);
      }
    }

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", async (event) => {
  setIsQuitting(true);
  destroyTray();

  if (serverProcess) {
    event.preventDefault();
    await stopServer();
    app.quit();
  }
});

ipcMain.handle("restart-server", restartServer);

ipcMain.handle("window-minimize", () => {
  mainWindow?.minimize();
});

ipcMain.handle("window-maximize", () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow?.maximize();
  }
});

ipcMain.handle("window-close", () => {
  setIsQuitting(true);
  mainWindow?.close();
});

ipcMain.handle("window-is-maximized", () => {
  return mainWindow?.isMaximized() ?? false;
});
