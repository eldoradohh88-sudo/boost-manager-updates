const { app, BrowserWindow, shell, Menu, ipcMain, nativeImage } = require('electron');
const { paletteFromBitmap } = require('./theme');
const path = require('path');

// on garde le même dossier de données qu'avant le changement de nom : personne n'a à se reconnecter
app.setPath('userData', path.join(app.getPath('appData'), 'Boost Manager'));

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

let win;

// logo recadré en carré (centre de l'image) pour l'icône de la fenêtre et de la barre des tâches
function squareLogo() {
  try {
    const img = nativeImage.createFromPath(path.join(__dirname, 'src', 'logo.png'));
    if (img.isEmpty()) return null;
    const { width, height } = img.getSize();
    const side = Math.min(width, height);
    return img.crop({ x: Math.floor((width - side) / 2), y: Math.floor((height - side) / 2), width: side, height: side })
      .resize({ width: 256, height: 256, quality: 'best' });
  } catch (_) { return null; }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1050,
    minHeight: 680,
    backgroundColor: '#0f1219',
    title: "Flowey's Software Manager",
    icon: squareLogo() || path.join(__dirname, 'src', 'logo.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Dans la version installée (.exe) on retire le menu ; en développement on le garde (Ctrl+Maj+I = outils).
  if (app.isPackaged) Menu.setApplicationMenu(null);

  win.loadFile(path.join(__dirname, 'src', 'index.html'));

  // Les liens externes s'ouvrent dans le navigateur, jamais dans l'app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) e.preventDefault();
  });
  win.webContents.once('did-finish-load', setupUpdater);
}

/* ---------------- mises à jour automatiques ---------------- */
let updaterReady = false;
function setupUpdater() {
  if (!app.isPackaged || updaterReady) return; // pas de mise à jour en mode test (2-TESTER.bat)
  updaterReady = true;
  let autoUpdater;
  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch (_) {
    return;
  }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  const send = (status) => { if (win && !win.isDestroyed()) win.webContents.send('updater', status); };
  let version = null;
  autoUpdater.on('update-available', (info) => { version = info.version; send({ state: 'downloading', version, percent: 0 }); });
  autoUpdater.on('download-progress', (p) => send({ state: 'downloading', version, percent: Math.round(p.percent || 0) }));
  autoUpdater.on('update-downloaded', (info) => send({ state: 'ready', version: info.version }));
  autoUpdater.on('error', (err) => console.error('Mise à jour :', err && err.message));
  const check = () => autoUpdater.checkForUpdates().catch(() => { /* hors ligne ou pas encore configuré */ });
  check();
  setInterval(check, 60 * 60 * 1000); // revérifie toutes les heures
  ipcMain.handle('updater-install', () => autoUpdater.quitAndInstall(false, true));
}
ipcMain.handle('app-version', () => app.getVersion());

// couleurs de l'app tirées automatiquement de src/logo.png
let themeCache;
ipcMain.handle('theme', () => {
  if (themeCache !== undefined) return themeCache;
  try {
    const img = nativeImage.createFromPath(path.join(__dirname, 'src', 'logo.png'));
    if (img.isEmpty()) return (themeCache = null);
    const small = img.resize({ width: 64, height: 64, quality: 'good' });
    const { width, height } = small.getSize();
    themeCache = paletteFromBitmap(small.toBitmap(), width, height);
  } catch (_) {
    themeCache = null;
  }
  return themeCache;
});

/* ---------------- Eldorado (espace admin) ----------------
   Ouvre eldorado.gg dans ton navigateur habituel : la vérification anti-robot y passe normalement,
   et ta connexion reste celle de ton navigateur. */
// ouvre un lien de commande Eldorado dans le navigateur (uniquement des adresses eldorado.gg)
ipcMain.handle('open-url', (_e, url) => {
  if (typeof url === 'string' && /^https:\/\/([a-z0-9-]+\.)*eldorado\.gg\//i.test(url)) shell.openExternal(url);
  return true;
});
ipcMain.handle('eldorado-open', () => {
  shell.openExternal('https://www.eldorado.gg/');
  return true;
});

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.setAppUserModelId('com.flowey.boostmanager'); // nécessaire aux notifications Windows

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
