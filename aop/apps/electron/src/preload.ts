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
  restartServer: () => ipcRenderer.invoke("restart-server"),
});
