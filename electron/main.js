const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

// electron-updater uses ESM internally but can be required via .cjs entrypoint
let autoUpdater;
try {
  autoUpdater = require('electron-updater').autoUpdater;
} catch (e) {
  console.warn('[AutoUpdater] Could not load electron-updater:', e.message);
}

let mainWindow = null;

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });

    // ─── Auto-Updater (only runs in packaged .exe) ───────────────────────────
    if (app.isPackaged && autoUpdater) {
      autoUpdater.logger = console;
      autoUpdater.autoDownload = true;
      autoUpdater.autoInstallOnAppQuit = true;

      // Check 5 seconds after start, then every hour
      setTimeout(() => { autoUpdater.checkForUpdates(); }, 5000);
      setInterval(() => { autoUpdater.checkForUpdates(); }, 60 * 60 * 1000);

      autoUpdater.on('checking-for-update', () => {
        console.log('[AutoUpdater] Checking for update...');
      });

      autoUpdater.on('update-available', (info) => {
        console.log('[AutoUpdater] Update available:', info.version);
        mainWindow?.webContents.send('update-available', info.version);
      });

      autoUpdater.on('update-not-available', (info) => {
        console.log('[AutoUpdater] Up to date. Version:', info.version);
      });

      autoUpdater.on('download-progress', (progress) => {
        const percent = Math.round(progress.percent);
        console.log(`[AutoUpdater] Downloading: ${percent}%`);
        mainWindow?.webContents.send('update-download-progress', percent);
      });

      autoUpdater.on('update-downloaded', (info) => {
        console.log('[AutoUpdater] Update downloaded:', info.version);
        mainWindow?.webContents.send('update-downloaded', info.version);
      });

      autoUpdater.on('error', (err) => {
        console.error('[AutoUpdater] Error:', err.message);
        mainWindow?.webContents.send('update-error', err.message);
      });
    }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1000,
    minHeight: 600,
    show: false,
    backgroundColor: '#0A0A0B',
    title: 'NOBREAK - Audio Builder',
    icon: path.join(__dirname, '../public/logo.png'),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false,
    },
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.autoHideMenuBar = true;

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  if (!app.isPackaged) {
    mainWindow.loadURL('http://127.0.0.1:3000');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

// IPC handlers
ipcMain.on('quit-app', () => { app.quit(); });

ipcMain.on('restart-and-install', () => {
  if (autoUpdater) autoUpdater.quitAndInstall();
});

ipcMain.on('check-for-updates', () => {
  if (app.isPackaged && autoUpdater) autoUpdater.checkForUpdates();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
