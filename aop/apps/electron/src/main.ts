import { type ChildProcess, spawn } from "child_process";
import { app, BrowserWindow, dialog, ipcMain } from "electron";
import path from "path";
import {
  createTray,
  destroyTray,
  getIsQuitting,
  setCheckForUpdatesFn,
  setIsQuitting,
  setMainWindow,
} from "./tray.js";
import { initAutoUpdater } from "./updater.js";

// Set app name for menu bar and dock
app.setName("AOP");
app.setAppUserModelId("com.aop.desktop");

let serverProcess: ChildProcess | null = null;
let mainWindow: BrowserWindow | null = null;
let serverPort: number | null = null;
const FORCE_KILL_TIMEOUT_MS = 10000;

const getServerPath = (): string => {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "aop-server");
  }
  // In dev mode, server is in sibling directory
  return path.join(__dirname, "..", "..", "local-server", "dist", "aop-server");
};

const getDashboardPath = (): string => {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "dashboard");
  }
  // In dev mode, dashboard is in sibling directory
  return path.join(__dirname, "..", "..", "dashboard", "dist");
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

const spawnServer = (): Promise<number> => {
  return new Promise((resolve, reject) => {
    const serverPath = getServerPath();
    const dashboardPath = getDashboardPath();
    console.log(`[Electron] Server path: ${serverPath}`);
    console.log(`[Electron] Dashboard path: ${dashboardPath}`);
    console.log(`[Electron] Server exists: ${require("fs").existsSync(serverPath)}`);

    // First, discover the port with a dummy URL
    let discoveryProcess: ChildProcess | null = null;
    let portFound = false;

    discoveryProcess = spawnServerWithEnv(
      serverPath,
      dashboardPath,
      "http://127.0.0.1:3847", // Dummy URL for discovery
    );

    const cleanupDiscovery = () => {
      if (discoveryProcess && !discoveryProcess.killed) {
        discoveryProcess.kill("SIGKILL");
      }
    };

    discoveryProcess.stdout?.on("data", (data: Buffer) => {
      const output = data.toString();

      // Look for port announcement
      const portMatch = output.match(/AOP_SERVER_PORT=(\d+)/);
      if (portMatch && !portFound) {
        portFound = true;
        const discoveredPort = parseInt(portMatch[1], 10);

        // Kill discovery process and start real one with correct URL
        cleanupDiscovery();

        // Start the real server with correct dashboard URL
        const dashboardUrl = `http://127.0.0.1:${discoveredPort}`;
        serverProcess = spawnServerWithEnv(serverPath, dashboardPath, dashboardUrl);
        serverPort = discoveredPort;

        // Forward events from real server
        serverProcess.stdout?.on("data", (data: Buffer) => {
          console.log("Server:", data.toString());
        });

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
          console.log(`Server exited with code ${code}`);
          if (code !== 0 && mainWindow) {
            mainWindow.webContents.send("server-crashed", code);
          }
          serverProcess = null;
        });

        resolve(discoveredPort);
      }

      // Look for errors
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

    // Timeout if no port received within 10 seconds
    setTimeout(() => {
      if (!portFound) {
        cleanupDiscovery();
        reject(new Error("Timeout waiting for server port discovery"));
      }
    }, 10000);
  });
};

const stopServer = async (): Promise<void> => {
  if (!serverProcess) return;

  return new Promise((resolve) => {
    // Try graceful shutdown with SIGTERM
    serverProcess?.kill("SIGTERM");

    // Force kill after timeout
    const forceKillTimer = setTimeout(() => {
      if (serverProcess && !serverProcess.killed) {
        serverProcess.kill("SIGKILL");
      }
    }, FORCE_KILL_TIMEOUT_MS);

    serverProcess?.on("exit", () => {
      clearTimeout(forceKillTimer);
      serverProcess = null;
      resolve();
    });

    // If already killed, resolve immediately
    if (serverProcess?.killed) {
      clearTimeout(forceKillTimer);
      serverProcess = null;
      resolve();
    }
  });
};

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    title: "AOP Desktop",
    webPreferences: {
      preload: path.join(__dirname, "..", "..", "src", "preload.ts"),
    },
  });

  // Set window reference for tray
  setMainWindow(mainWindow);

  // Show loading page first
  const indexPath = app.isPackaged
    ? path.join(__dirname, "renderer", "main_window", "index.html")
    : path.join(__dirname, "..", "src", "index.html");
  console.log(`[Electron] Loading index from: ${indexPath}`);
  mainWindow.loadFile(indexPath);

  // Show window immediately when loading page is ready
  mainWindow.once("ready-to-show", () => {
    console.log("[Electron] Window ready, showing...");
    mainWindow?.show();
  });

  // Handle window close - hide to tray instead of quitting
  mainWindow.on("close", (event) => {
    if (!getIsQuitting()) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
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
    } catch {
      // Server not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
};

const loadDashboard = async (port: number) => {
  if (!mainWindow) return;

  console.log(`[Electron] Waiting for server on port ${port}...`);
  const isReady = await waitForServer(port);

  if (!isReady) {
    console.error(`[Electron] Server on port ${port} failed to respond`);
    mainWindow.webContents.send("server-error", "Server failed to start");
    return;
  }

  console.log(`[Electron] Server ready, loading dashboard...`);
  mainWindow.loadURL(`http://127.0.0.1:${port}`);
  // Keep window title as "AOP Desktop" instead of letting HTML change it
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

// Single instance lock
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    // Someone tried to run a second instance, focus our window instead
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    console.log("[Electron] App ready, creating window...");
    createWindow();
    console.log("[Electron] Window created");

    // Create tray icon
    createTray();
    console.log("[Electron] Tray created");

    // Initialize auto-updater
    if (mainWindow) {
      const updater = initAutoUpdater(mainWindow);
      setCheckForUpdatesFn(() => updater.checkForUpdates());
    }

    console.log("[Electron] Spawning server...");
    try {
      const port = await spawnServer();
      console.log(`[Electron] Server started on port ${port}, loading dashboard...`);
      loadDashboard(port);
    } catch (err) {
      const errorMsg = String(err);
      console.error("Failed to start server:", errorMsg);

      // Show native error dialog for critical errors
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
  // Mark that we're actually quitting (not just closing to tray)
  setIsQuitting(true);

  // Destroy tray icon
  destroyTray();

  if (serverProcess) {
    event.preventDefault();
    await stopServer();
    app.quit();
  }
});

// IPC handlers
ipcMain.handle("restart-server", restartServer);
