interface ElectronAPI {
  onServerCrashed: (callback: (code: number) => void) => void;
  onServerError: (callback: (error: string) => void) => void;
  onServerRestarted: (callback: () => void) => void;
  onStatusUpdate: (callback: (status: string) => void) => void;
  restartServer: () => Promise<void>;
  minimizeWindow: () => Promise<void>;
  maximizeWindow: () => Promise<void>;
  closeWindow: () => Promise<void>;
  isMaximized: () => Promise<boolean>;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
