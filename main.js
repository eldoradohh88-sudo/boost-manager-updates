const { app, BrowserWindow, shell, Menu, ipcMain, nativeImage } = require('electron');
const { paletteFromBitmap } = require('./theme');
const path = require('path');

// on garde le même dossier de données qu'avant le changement de nom : personne n'a à se reconnecter
app.setPath('userData', path.join(app.getPath('appData'), 'Boost Manager'));

// réglages lus avant le démarrage (ex. accélération graphique coupée pour les PC qui rament)
const fs0 = require('fs');
const bootPrefsPath = () => path.join(app.getPath('userData'), 'boot-prefs.json');
let bootPrefs = {};
try { bootPrefs = JSON.parse(fs0.readFileSync(bootPrefsPath(), 'utf8')) || {}; } catch (_) { bootPrefs = {}; }
if (bootPrefs.gpu === false) app.disableHardwareAcceleration();

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

const fs = require('fs');
let win;

// logo : celui choisi par l'utilisateur sur ce PC (Paramètres / Ma licence), sinon celui de l'app
const customLogoPath = () => path.join(app.getPath('userData'), 'custom-logo.png');
const hasCustomLogo = () => { try { return fs.existsSync(customLogoPath()); } catch (_) { return false; } };
const logoPath = () => (hasCustomLogo() ? customLogoPath() : path.join(__dirname, 'src', 'logo.png'));

// logo recadré en carré (centre de l'image) pour l'icône de la fenêtre et de la barre des tâches
function squareLogo() {
  try {
    const img = nativeImage.createFromPath(logoPath());
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
// téléchargement d'une pièce jointe (Windows demande où l'enregistrer)
ipcMain.handle('download-url', (_e, url) => {
  if (typeof url !== 'string' || !/^https:\/\/[a-z0-9-]+\.supabase\.co\//i.test(url)) return false;
  if (win && !win.isDestroyed()) win.webContents.downloadURL(url);
  return true;
});
ipcMain.handle('set-zoom', (_e, f) => {
  const z = Math.min(1.4, Math.max(0.75, Number(f) || 1));
  if (win && !win.isDestroyed()) win.webContents.setZoomFactor(z);
  return z;
});
ipcMain.handle('gpu-get', () => bootPrefs.gpu !== false);
ipcMain.handle('gpu-set', (_e, on) => {
  bootPrefs.gpu = !!on;
  try { fs0.mkdirSync(app.getPath('userData'), { recursive: true }); fs0.writeFileSync(bootPrefsPath(), JSON.stringify(bootPrefs)); } catch (_) { /* rien */ }
  app.relaunch(); app.exit(0);
});

// couleurs de l'app tirées automatiquement de src/logo.png
let themeCache;
function computeTheme() {
  if (themeCache !== undefined) return themeCache;
  try {
    const img = nativeImage.createFromPath(logoPath());
    if (img.isEmpty()) return (themeCache = null);
    const small = img.resize({ width: 64, height: 64, quality: 'good' });
    const { width, height } = small.getSize();
    themeCache = paletteFromBitmap(small.toBitmap(), width, height);
  } catch (_) {
    themeCache = null;
  }
  return themeCache;
}
ipcMain.handle('theme', () => computeTheme());

// logo affiché dans l'app (carré 256 px, en data URL)
function logoInfo() {
  const sq = squareLogo();
  return { url: sq ? sq.toDataURL() : null, custom: hasCustomLogo() };
}
// Icône des raccourcis Windows (barre des tâches épinglée, bureau, menu Démarrer) = logo choisi
function icoFromImage(img) {
  // fichier .ico contenant une image PNG 256 x 256 (format accepté par Windows depuis Vista)
  const png = img.resize({ width: 256, height: 256, quality: 'best' }).toPNG();
  const head = Buffer.alloc(22);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(1, 4); // ICO, 1 image
  head.writeUInt8(0, 6); head.writeUInt8(0, 7); // 0 = 256 px
  head.writeUInt8(0, 8); head.writeUInt8(0, 9);
  head.writeUInt16LE(1, 10); head.writeUInt16LE(32, 12);
  head.writeUInt32LE(png.length, 14); head.writeUInt32LE(22, 18);
  return Buffer.concat([head, png]);
}
function shortcutPaths() {
  const name = "Flowey's Software Manager.lnk";
  const appData = app.getPath('appData');
  return [
    path.join(app.getPath('desktop'), name),
    path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', name),
    path.join(appData, 'Microsoft', 'Internet Explorer', 'Quick Launch', 'User Pinned', 'TaskBar', name),
  ];
}
function applyShortcutIcons() {
  if (process.platform !== 'win32' || !app.isPackaged) return 0;
  let icon = process.execPath; // logo de base de l'app
  if (hasCustomLogo()) {
    const sq = squareLogo();
    if (sq) {
      icon = path.join(app.getPath('userData'), 'custom-logo.ico');
      try { fs.writeFileSync(icon, icoFromImage(sq)); } catch (_) { icon = process.execPath; }
    }
  }
  let done = 0;
  for (const lnk of shortcutPaths()) {
    try {
      if (!fs.existsSync(lnk)) continue;
      const cur = shell.readShortcutLink(lnk);
      if (!cur.target || path.resolve(cur.target).toLowerCase() !== path.resolve(process.execPath).toLowerCase()) continue;
      if (shell.writeShortcutLink(lnk, 'update', { icon, iconIndex: 0 })) done++;
    } catch (_) { /* raccourci inaccessible : on passe */ }
  }
  return done;
}
function logoChanged() {
  themeCache = undefined;
  const sq = squareLogo();
  if (sq && win && !win.isDestroyed()) win.setIcon(sq);
  applyShortcutIcons();
  return { ...logoInfo(), theme: computeTheme() };
}
ipcMain.handle('logo-get', () => logoInfo());
ipcMain.handle('logo-set', (_e, dataUrl) => {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png;base64,') || dataUrl.length > 4 * 1024 * 1024) throw new Error('Image invalide');
  const img = nativeImage.createFromDataURL(dataUrl);
  if (img.isEmpty()) throw new Error('Image illisible');
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  fs.writeFileSync(customLogoPath(), img.toPNG());
  return logoChanged();
});
ipcMain.handle('logo-reset', () => {
  try { fs.unlinkSync(customLogoPath()); } catch (_) { /* déjà retiré */ }
  return logoChanged();
});

// bannière de fond personnelle (image ou GIF animé), gardée sur ce PC
const BANNER_TYPES = { 'image/gif': 'gif', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const bannerFile = () => {
  for (const ext of Object.values(BANNER_TYPES)) {
    const f = path.join(app.getPath('userData'), 'banner.' + ext);
    if (fs.existsSync(f)) return { f, ext };
  }
  return null;
};
ipcMain.handle('banner-get', () => {
  try {
    const b = bannerFile();
    if (!b) return null;
    const mime = Object.keys(BANNER_TYPES).find((m) => BANNER_TYPES[m] === b.ext);
    return `data:${mime};base64,${fs.readFileSync(b.f).toString('base64')}`;
  } catch (_) { return null; }
});
ipcMain.handle('banner-set', (_e, dataUrl) => {
  const m = typeof dataUrl === 'string' && dataUrl.match(/^data:(image\/(?:gif|png|jpeg|webp));base64,/);
  if (!m) throw new Error('Format non pris en charge (GIF, PNG, JPG ou WEBP)');
  if (dataUrl.length > 40 * 1024 * 1024) throw new Error('Bannière trop lourde (30 Mo max)');
  const old = bannerFile();
  if (old) fs.unlinkSync(old.f);
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  fs.writeFileSync(path.join(app.getPath('userData'), 'banner.' + BANNER_TYPES[m[1]]), Buffer.from(dataUrl.slice(m[0].length), 'base64'));
  return true;
});
ipcMain.handle('banner-reset', () => {
  const old = bannerFile();
  if (old) fs.unlinkSync(old.f);
  return true;
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

app.whenReady().then(() => {
  createWindow();
  // après une mise à jour, Windows remet l'icône de base sur les raccourcis : on remet celle de l'utilisateur
  if (hasCustomLogo()) setTimeout(() => { try { applyShortcutIcons(); } catch (_) { /* rien */ } }, 3000);
});
app.on('window-all-closed', () => app.quit());
