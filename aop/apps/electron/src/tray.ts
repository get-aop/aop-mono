import { app, BrowserWindow, Menu, Tray, nativeImage } from 'electron';
import path from 'path';

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

const createTrayIcon = (): Electron.NativeImage => {
  // Use different icon paths based on platform
  let iconPath: string;
  
  if (process.platform === 'darwin') {
    // macOS uses 16x16 or 18x18 template icons
    iconPath = path.join(process.resourcesPath, 'tray-iconTemplate.png');
  } else if (process.platform === 'win32') {
    // Windows uses ICO or PNG
    iconPath = path.join(process.resourcesPath, 'tray-icon.png');
  } else {
    // Linux uses PNG
    iconPath = path.join(process.resourcesPath, 'tray-icon.png');
  }

  try {
    const icon = nativeImage.createFromPath(iconPath);
    
    // On macOS, mark as template image for dark mode support
    if (process.platform === 'darwin') {
      icon.setTemplateImage(true);
    }
    
    return icon;
  } catch {
    // Fallback: create a simple colored square icon programmatically
    // 16x16 transparent PNG as base64 (simple blue square)
    const fallbackIcon = nativeImage.createFromBuffer(
      Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAAdgAAAHYBTnsmCAAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAABVSURBVDiNY2AYBaNg2ALG/xjogmE0Y//DwPgfDNg0wKYZRjOQGohqAIpPxjCYJqhmGI0t0Dg0w2hsoEajNUNpRlMzU2gG08ygZ6bRaKbVzAQAxBEU/X8q+UAAAAAASUVORK5CYII=', 'base64')
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
      label: 'Open Dashboard',
      click: showWindow
    },
    { type: 'separator' }
  ];

  // Add check for updates if available
  if (checkForUpdatesFn) {
    template.push({
      label: 'Check for Updates',
      click: checkForUpdatesFn
    });
    template.push({ type: 'separator' });
  }

  template.push({
    label: 'Quit',
    click: () => {
      isQuitting = true;
      app.quit();
    }
  });

  return Menu.buildFromTemplate(template);
};

export const createTray = (): Tray => {
  if (tray) {
    return tray;
  }

  const icon = createTrayIcon();
  tray = new Tray(icon);
  
  tray.setToolTip('AOP Desktop');
  tray.setContextMenu(createContextMenu());
  
  // Click behavior varies by platform
  tray.on('click', () => {
    if (process.platform === 'darwin') {
      // macOS: left click shows context menu
      tray?.popUpContextMenu();
    } else {
      // Windows/Linux: left click toggles window
      if (mainWindow?.isVisible()) {
        mainWindow.hide();
      } else {
        showWindow();
      }
    }
  });

  tray.on('double-click', showWindow);
  
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
