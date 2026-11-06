const { contextBridge, ipcRenderer } = require("electron");

// The only desktop features the web UI can reach. Everything goes through IPC so the page stays sandboxed.
contextBridge.exposeInMainWorld("sessionDesktop", {
  isElectron: true,
  notificationsSupported: () => ipcRenderer.invoke("notify:supported"),
  notify: (options) => ipcRenderer.invoke("notify:show", options),
  onNotificationClick: (handler) => {
    const listener = (_event, tag) => handler(tag);
    ipcRenderer.on("notify:click", listener);
    return () => ipcRenderer.removeListener("notify:click", listener);
  },
  windowFocused: () => ipcRenderer.invoke("window:focused"),
});
