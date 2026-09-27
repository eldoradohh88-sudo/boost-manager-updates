// Pont sécurisé entre la fenêtre et Electron : uniquement le strict nécessaire (mises à jour, ouvrir Eldorado).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  onUpdate: (callback) => ipcRenderer.on('updater', (_event, status) => callback(status)),
  installUpdate: () => ipcRenderer.invoke('updater-install'),
  version: () => ipcRenderer.invoke('app-version'),
  theme: () => ipcRenderer.invoke('theme'),
  logo: () => ipcRenderer.invoke('logo-get'),
  setLogo: (dataUrl) => ipcRenderer.invoke('logo-set', dataUrl),
  resetLogo: () => ipcRenderer.invoke('logo-reset'),
  eldoradoOpen: () => ipcRenderer.invoke('eldorado-open'),
  openUrl: (url) => ipcRenderer.invoke('open-url', url),
});
