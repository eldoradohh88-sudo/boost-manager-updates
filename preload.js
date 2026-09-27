// Pont sécurisé entre la fenêtre et Electron : uniquement le strict nécessaire (mises à jour, ouvrir Eldorado).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  onUpdate: (callback) => ipcRenderer.on('updater', (_event, status) => callback(status)),
  installUpdate: () => ipcRenderer.invoke('updater-install'),
  version: () => ipcRenderer.invoke('app-version'),
  download: (url) => ipcRenderer.invoke('download-url', url),
  setZoom: (f) => ipcRenderer.invoke('set-zoom', f),
  gpu: () => ipcRenderer.invoke('gpu-get'),
  setGpu: (on) => ipcRenderer.invoke('gpu-set', on),
  theme: () => ipcRenderer.invoke('theme'),
  logo: () => ipcRenderer.invoke('logo-get'),
  setLogo: (dataUrl) => ipcRenderer.invoke('logo-set', dataUrl),
  resetLogo: () => ipcRenderer.invoke('logo-reset'),
  banner: () => ipcRenderer.invoke('banner-get'),
  setBanner: (dataUrl) => ipcRenderer.invoke('banner-set', dataUrl),
  resetBanner: () => ipcRenderer.invoke('banner-reset'),
  eldoradoOpen: () => ipcRenderer.invoke('eldorado-open'),
  openUrl: (url) => ipcRenderer.invoke('open-url', url),
});
