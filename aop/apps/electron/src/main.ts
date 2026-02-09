import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import { createTray, destroyTray, setMainWindow, getIsQuitting, setIsQuitting, setCheckForUpdatesFn } from './tray.js';
import { initAutoUpdater } from './updater.js';

let serverProcess: ChildProcess | null = null;
let mainWindow: BrowserWindow | null = null;
let serverPort: number | null = null;
const FORCE_KILL_TIMEOUT_MS = 10000;

const getServerPath = (): string => {
  return path.join(process.resourcesPath, 'aop-server');
};

const getDashboardPath = (): string => {
  return path.join(process.resourcesPath, 'dashboard');
};

const spawnServer = (): Promise<number> => {
  return new Promise((resolve, reject) => {
    const serverPath = getServerPath();
    const dashboardPath = getDashboardPath();
    
    serverProcess = spawn(serverPath, [], {
      env: {
        ...process.env,
        AOP_ELECTRON_SIDECAR: '1',
        AOP_DB_PATH: path.join(app.getPath('userData'), 'aop.db'),
        DASHBOARD_STATIC_PATH: dashboardPath,
      },
      detached: false,
    });

    let portFound = false;

    serverProcess.stdout?.on('data', (data: Buffer) => {
      const output = data.toString();
      
      // Look for port announcement
      const portMatch = output.match(/AOP_SERVER_PORT=(\d+)/);
      if (portMatch && !portFound) {
        portFound = true;
        serverPort = parseInt(portMatch[1], 10);
        resolve(serverPort);
      }

      // Look for errors
      const errorMatch = output.match(/AOP_SERVER_ERROR=(.+)/);
      if (errorMatch && !portFound) {
        reject(new Error(errorMatch[1]));
      }
    });

    serverProcess.stderr?.on('data', (data: Buffer) => {
      console.error('Server stderr:', data.toString());
    });

    serverProcess.on('error', (err) => {
      if (!portFound) {
        reject(err);
      }
    });

    serverProcess.on('exit', (code) => {
      if (!portFound) {
        reject(new Error(`Server exited with code ${code}`));
      } else {
        // Server crashed after starting
        if (code !== 0 && mainWindow) {
          mainWindow.webContents.send('server-crashed', code);
        }
      }
    });

    // Timeout if no port received within 30 seconds
    setTimeout(() => {
      if (!portFound) {
        reject(new Error('Timeout waiting for server port'));
      }
    }, 30000);
  });
};

const stopServer = async (): Promise<void> => {
  if (!serverProcess) return;

  return new Promise((resolve) => {
    // Try graceful shutdown with SIGTERM
    serverProcess?.kill('SIGTERM');

    // Force kill after timeout
    const forceKillTimer = setTimeout(() => {
      if (serverProcess && !serverProcess.killed) {
        serverProcess.kill('SIGKILL');
      }
    }, FORCE_KILL_TIMEOUT_MS);

    serverProcess?.on('exit', () => {
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
    show: false, // Don't show until server is ready
    webPreferences: {
      preload: path.join(__dirname, 'preload.js')
    }
  });

  // Set window reference for tray
  setMainWindow(mainWindow);

  // Show loading page first
  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.once('ready-to-show', () => {
    // Window is ready but we'll show it after server loads
  });

  // Handle window close - hide to tray instead of quitting
  mainWindow.on('close', (event) => {
    if (!getIsQuitting()) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
};

const loadDashboard = (port: number) => {
  if (mainWindow) {
    mainWindow.loadURL(`http://127.0.0.1:${port}`);
    mainWindow.show();
  }
};

const restartServer = async () => {
  if (serverProcess) {
    await stopServer();
  }
  
  try {
    const port = await spawnServer();
    loadDashboard(port);
    if (mainWindow) {
      mainWindow.webContents.send('server-restarted');
    }
  } catch (err) {
    console.error('Failed to restart server:', err);
    if (mainWindow) {
      mainWindow.webContents.send('server-error', String(err));
    }
  }
};

// Single instance lock
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    // Someone tried to run a second instance, focus our window instead
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    createWindow();

    // Create tray icon
    createTray();

    // Initialize auto-updater
    if (mainWindow) {
      const updater = initAutoUpdater(mainWindow);
      setCheckForUpdatesFn(() => updater.checkForUpdates());
    }

    try {
      const port = await spawnServer();
      loadDashboard(port);
    } catch (err) {
      const errorMsg = String(err);
      console.error('Failed to start server:', errorMsg);
      
      // Show native error dialog for critical errors
      if (errorMsg.includes('No available ports') || errorMsg.includes('Timeout waiting')) {
        dialog.showErrorBox(
          'AOP Desktop Error',
          `Failed to start the AOP server.\n\n${errorMsg}\n\nPlease ensure no other applications are using ports 3847-3899 and try again.`
        );
        app.quit();
        return;
      }
      
      if (mainWindow) {
        mainWindow.webContents.send('server-error', errorMsg);
      }
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', async (event) => {
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
ipcMain.handle('restart-server', restartServer);
