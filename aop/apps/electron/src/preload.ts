import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  onServerCrashed: (callback: (code: number) => void) => {
    ipcRenderer.on("server-crashed", (_, code) => callback(code));
  },
  onServerError: (callback: (error: string) => void) => {
    ipcRenderer.on("server-error", (_, error) => callback(error));
  },
  onServerRestarted: (callback: () => void) => {
    ipcRenderer.on("server-restarted", () => callback());
  },
  onStatusUpdate: (callback: (status: string) => void) => {
    ipcRenderer.on("status-update", (_, status) => callback(status));
  },
  restartServer: () => ipcRenderer.invoke("restart-server"),
  minimizeWindow: () => ipcRenderer.invoke("window-minimize"),
  maximizeWindow: () => ipcRenderer.invoke("window-maximize"),
  closeWindow: () => ipcRenderer.invoke("window-close"),
  isMaximized: () => ipcRenderer.invoke("window-is-maximized"),
});
