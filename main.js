const { app, BrowserWindow, dialog, ipcMain, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');

const PRODUCT_NAME = 'E-Class Record App with GS and SF9';
let mainWindow;

function dataPaths() {
  const root = path.join(app.getPath('documents'), PRODUCT_NAME);
  return {
    root,
    dataFile: path.join(root, 'eclass-record-data.json'),
    backupDir: path.join(root, 'Backups')
  };
}

function ensureDataFolders() {
  const p = dataPaths();
  fs.mkdirSync(p.root, { recursive: true });
  fs.mkdirSync(p.backupDir, { recursive: true });
  return p;
}

function safeWriteJsonText(filePath, text) {
  JSON.parse(text); // validate before touching the existing file
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, filePath);
}

function makeDailyBackup(text) {
  const p = ensureDataFolders();
  const date = new Date().toISOString().slice(0, 10);
  const backup = path.join(p.backupDir, `auto-backup-${date}.json`);
  if (!fs.existsSync(backup)) fs.writeFileSync(backup, text, 'utf8');
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 980,
    minHeight: 680,
    title: PRODUCT_NAME,
    icon: path.join(__dirname, 'assets', 'app.png'),
    backgroundColor: '#F1E9D6',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'app', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

function buildMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        { label: 'Print', accelerator: 'CmdOrCtrl+P', click: () => mainWindow?.webContents.print({ printBackground: true }) },
        { type: 'separator' },
        { label: 'Open Data Folder', click: () => shell.openPath(ensureDataFolders().root) },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' }, { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About',
          click: () => dialog.showMessageBox(mainWindow, {
            type: 'info',
            title: `About ${PRODUCT_NAME}`,
            message: PRODUCT_NAME,
            detail: `Version ${app.getVersion()}\nOffline desktop class record, grading sheet, and SF9 application.`
          })
        }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

ipcMain.on('data:load-sync', (event) => {
  try {
    const p = ensureDataFolders();
    event.returnValue = fs.existsSync(p.dataFile) ? fs.readFileSync(p.dataFile, 'utf8') : null;
  } catch (err) {
    console.error('Load failed:', err);
    event.returnValue = null;
  }
});

ipcMain.handle('data:save', async (_event, text) => {
  try {
    const p = ensureDataFolders();
    safeWriteJsonText(p.dataFile, text);
    makeDailyBackup(text);
    return { ok: true, path: p.dataFile };
  } catch (err) {
    console.error('Save failed:', err);
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('backup:export', async (_event, text) => {
  try {
    JSON.parse(text);
    const date = new Date().toISOString().slice(0, 10);
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Export Gradebook Backup',
      defaultPath: path.join(app.getPath('documents'), `eclass-record-backup-${date}.json`),
      filters: [{ name: 'JSON Backup', extensions: ['json'] }]
    });
    if (canceled || !filePath) return { ok: false, cancelled: true };
    safeWriteJsonText(filePath, text);
    return { ok: true, path: filePath };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('backup:import', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'Import Gradebook Backup',
    properties: ['openFile'],
    filters: [{ name: 'JSON Backup', extensions: ['json'] }]
  });
  if (canceled || !filePaths[0]) return { cancelled: true };
  const text = fs.readFileSync(filePaths[0], 'utf8');
  JSON.parse(text);
  return { cancelled: false, text, path: filePaths[0] };
});

ipcMain.handle('data:location', async () => ensureDataFolders().root);

app.whenReady().then(() => {
  ensureDataFolders();
  createWindow();
  buildMenu();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
