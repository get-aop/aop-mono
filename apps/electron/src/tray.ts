import path from "node:path";
import { app, type BrowserWindow, Menu, nativeImage, Tray } from "electron";

let tray: Tray | null = null;
let mainWindow: BrowserWindow | null = null;
let isQuitting = false;

export const setMainWindow = (window: BrowserWindow) => {
  mainWindow = window;
};

export const getIsQuitting = (): boolean => isQuitting;

export const setIsQuitting = (value: boolean) => {
  isQuitting = value;
};

export const getAssetPath = (filename: string): string => {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, filename);
  }
  return path.join(__dirname, "..", "assets", filename);
};

const createTrayIcon = (): Electron.NativeImage => {
  const iconFile = process.platform === "darwin" ? "tray-iconTemplate.png" : "tray-icon.png";
  const iconPath = getAssetPath(iconFile);

  try {
    const icon = nativeImage.createFromPath(iconPath);

    if (process.platform === "darwin") {
      icon.setTemplateImage(true);
    }

    return icon;
  } catch {
    const fallbackIcon = nativeImage.createFromBuffer(
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAAdgAAAHYBTnsmCAAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAABVSURBVDiNY2AYBaNg2ALG/xjogmE0Y//DwPgfDNg0wKYZRjOQGohqAIpPxjCYJqhmGI0t0Dg0w2hsoEajNUNpRlMzU2gG08ygZ6bRaKbVzAQAxBEU/X8q+UAAAAAASUVORK5CYII=",
        "base64",
      ),
    );
    return fallbackIcon;
  }
};

const showWindow = () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.show();
    mainWindow.focus();
  }
};

let checkForUpdatesFn: (() => void) | null = null;

export const setCheckForUpdatesFn = (fn: () => void) => {
  checkForUpdatesFn = fn;
};

const createContextMenu = (): Menu => {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: "Open Dashboard",
      click: showWindow,
    },
    { type: "separator" },
  ];

  if (checkForUpdatesFn) {
    template.push({
      label: "Check for Updates",
      click: checkForUpdatesFn,
    });
    template.push({ type: "separator" });
  }

  template.push({
    label: "Quit",
    click: () => {
      isQuitting = true;
      app.quit();
    },
  });

  return Menu.buildFromTemplate(template);
};

export const createTray = (): Tray => {
  if (tray) {
    return tray;
  }

  const icon = createTrayIcon();
  tray = new Tray(icon);

  tray.setToolTip("AOP Desktop");
  tray.setContextMenu(createContextMenu());

  tray.on("click", () => {
    if (process.platform === "darwin") {
      tray?.popUpContextMenu();
    } else {
      if (mainWindow?.isVisible()) {
        mainWindow.hide();
      } else {
        showWindow();
      }
    }
  });

  tray.on("double-click", showWindow);

  return tray;
};

export const destroyTray = () => {
  if (tray) {
    tray.destroy();
    tray = null;
  }
};

export const updateTrayTooltip = (tooltip: string) => {
  if (tray) {
    tray.setToolTip(tooltip);
  }
};
