import { app, dialog, BrowserWindow } from 'electron';
import { autoUpdater } from 'electron-updater';
import { updateTrayTooltip } from './tray.js';

let updateCheckInProgress = false;

export const initAutoUpdater = (mainWindow: BrowserWindow) => {
  // Configure auto-updater
  autoUpdater.autoDownload = false; // We'll prompt user first
  autoUpdater.autoInstallOnAppQuit = true;

  // Check for updates on launch (silently - no error dialogs on failure)
  const checkForUpdates = async () => {
    if (updateCheckInProgress) return;
    
    // Skip if in development
    if (process.env.NODE_ENV === 'development') {
      console.log('Skipping update check in development mode');
      return;
    }

    updateCheckInProgress = true;
    updateTrayTooltip('AOP Desktop - Checking for updates...');

    try {
      await autoUpdater.checkForUpdates();
    } catch (err) {
      // Silently fail - no error dialogs for offline/failure
      console.log('Update check failed (likely offline):', err);
    } finally {
      updateCheckInProgress = false;
      updateTrayTooltip('AOP Desktop');
    }
  };

  // Check on startup (after a short delay to not block app launch)
  setTimeout(checkForUpdates, 5000);

  // Event: Update available
  autoUpdater.on('update-available', (info) => {
    console.log('Update available:', info.version);
    
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Update Available',
      message: `AOP Desktop v${info.version} is available.`,
      detail: 'The update will be downloaded and installed when you restart the app.',
      buttons: ['Download & Install Later', 'Install on Restart'],
      defaultId: 1,
      cancelId: 0
    }).then((result) => {
      if (result.response === 1) {
        // User wants to install on restart
        autoUpdater.downloadUpdate();
      } else {
        // Download in background
        autoUpdater.downloadUpdate();
      }
    });
  });

  // Event: Update downloaded
  autoUpdater.on('update-downloaded', (info) => {
    console.log('Update downloaded:', info.version);
    
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Update Ready',
      message: `AOP Desktop v${info.version} has been downloaded.`,
      detail: 'The update will be installed when you restart the application.',
      buttons: ['Restart Now', 'Later'],
      defaultId: 0
    }).then((result) => {
      if (result.response === 0) {
        autoUpdater.quitAndInstall();
      }
    });
  });

  // Event: Error (handle gracefully - no dialogs)
  autoUpdater.on('error', (err) => {
    console.error('Auto-updater error:', err);
    // Don't show error dialog - user might be offline or GitHub unavailable
    // Just log it silently
  });

  // Event: No update available
  autoUpdater.on('update-not-available', () => {
    console.log('No updates available');
  });

  // Event: Download progress
  autoUpdater.on('download-progress', (progressObj) => {
    const percent = Math.round(progressObj.percent);
    updateTrayTooltip(`AOP Desktop - Downloading update: ${percent}%`);
  });

  // Manual check for updates (e.g., from menu)
  return {
    checkForUpdates: async () => {
      if (updateCheckInProgress) {
        dialog.showMessageBox(mainWindow, {
          type: 'info',
          title: 'Update Check',
          message: 'Already checking for updates...'
        });
        return;
      }

      try {
        const result = await autoUpdater.checkForUpdates();
        if (!result || result.updateInfo.version === app.getVersion()) {
          dialog.showMessageBox(mainWindow, {
            type: 'info',
            title: 'No Updates',
            message: 'You are running the latest version.',
            detail: `Current version: ${app.getVersion()}`
          });
        }
      } catch (err) {
        console.error('Manual update check failed:', err);
        dialog.showMessageBox(mainWindow, {
          type: 'warning',
          title: 'Update Check Failed',
          message: 'Could not check for updates.',
          detail: 'Please check your internet connection or try again later.'
        });
      }
    }
  };
};
