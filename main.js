const { app, BrowserWindow, dialog, ipcMain, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const crypto = require('crypto');
const AdmZip = require('adm-zip');
const { parseOfficialSf1Xls } = require('./sf1-parser');
const { ThreadUpdater } = require('./thread-updater');

const PRODUCT_NAME = 'E-Class Record App with GS and SF9';
const APP_ID = 'ph.edu.eclassrecord.gs.sf9';
let mainWindow;
let threadUpdater = null;
let runtimeExtension = null;
const SAFE_ID_RE = /^[A-Za-z0-9_.:-]{1,160}$/;
const MAX_OFFICIAL_IMPORT_BYTES = 25 * 1024 * 1024;
const MAX_XLSX_UNCOMPRESSED_BYTES = 128 * 1024 * 1024;
const MAX_XLSX_ENTRY_BYTES = 32 * 1024 * 1024;
const MAX_XLSX_ENTRIES = 1000;

function isTrustedMainSender(event) {
  return !!(mainWindow && !mainWindow.isDestroyed() && event && event.sender === mainWindow.webContents);
}

function rejectUntrustedInvoke(event) {
  return isTrustedMainSender(event) ? null : { ok: false, error: 'Request rejected from an untrusted window.' };
}

function dataPaths() {
  const root = path.join(app.getPath('documents'), PRODUCT_NAME);
  return {
    root,
    dataFile: path.join(root, 'eclass-record-data.json'),
    recoveryFile: path.join(root, 'eclass-record-data.previous.json'),
    backupDir: path.join(root, 'Backups')
  };
}

function ensureDataFolders() {
  const p = dataPaths();
  fs.mkdirSync(p.root, { recursive: true });
  fs.mkdirSync(p.backupDir, { recursive: true });
  return p;
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function sanitizeJsonValue(value, depth = 0, counter = { nodes: 0 }) {
  if (++counter.nodes > 500000) throw new Error('The data file is too complex to process safely.');
  if (depth > 24) throw new Error('The data file is nested too deeply.');
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('The data file contains an invalid number.');
    return value;
  }
  if (typeof value === 'string') {
    if (value.length > 16 * 1024 * 1024) throw new Error('The data file contains an unexpectedly large text value.');
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > 100000) throw new Error('The data file contains an unexpectedly large array.');
    return value.map(v => sanitizeJsonValue(v, depth + 1, counter));
  }
  if (!isPlainObject(value)) throw new Error('The data file contains an unsupported object type.');
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === '__proto__' || key === 'prototype' || key === 'constructor') {
      throw new Error('The data file contains a prohibited object key.');
    }
    if (key.length > 256) throw new Error('The data file contains an invalid property name.');
    out[key] = sanitizeJsonValue(child, depth + 1, counter);
  }
  return out;
}

function parseAndValidateAppState(text) {
  if (typeof text !== 'string') throw new Error('Application data must be JSON text.');
  if (Buffer.byteLength(text, 'utf8') > 64 * 1024 * 1024) throw new Error('Application data exceeds the 64 MB safety limit.');
  const parsed = JSON.parse(text);
  const safe = sanitizeJsonValue(parsed);
  if (!safe || !isPlainObject(safe.classes) || !Object.keys(safe.classes).length) {
    throw new Error('This is not a valid E-Class Record data file.');
  }
  if (Object.keys(safe.classes).length > 2000) throw new Error('The data file contains too many classes.');
  const records = Object.entries(safe.classes).map(([id, value]) => ({ id, value, adviser: false }));
  if (safe.adviserWorkspace !== undefined) {
    if (!isPlainObject(safe.adviserWorkspace)) throw new Error('The data file contains an invalid Adviser workspace.');
    records.push({ id: 'adviserWorkspace', value: safe.adviserWorkspace, adviser: true });
  }
  for (const { id: classId, value: cls, adviser } of records) {
    if (!adviser && !SAFE_ID_RE.test(classId)) throw new Error('The data file contains an invalid class identifier.');
    if (!isPlainObject(cls)) throw new Error(`Class ${classId} has an invalid structure.`);
    if (!isPlainObject(cls.meta)) throw new Error(`Class ${classId} has missing or invalid metadata.`);
    if (!Array.isArray(cls.students)) throw new Error(`Class ${classId} has a missing or invalid learner list.`);
    if (cls.students.length > 1000) throw new Error(`Class ${classId} contains too many learners.`);
    for (const student of cls.students) {
      if (!isPlainObject(student)) throw new Error(`Class ${classId} contains an invalid learner record.`);
      if (!student.id || !SAFE_ID_RE.test(String(student.id))) throw new Error('The data file contains an invalid learner identifier.');
    }
    if (!adviser) {
      if (!isPlainObject(cls.categories)) throw new Error(`Class ${classId} has a missing or invalid grading-category structure.`);
      for (const categoryKey of ['WW','PT','EXAM']) {
        const category = cls.categories[categoryKey];
        if (!isPlainObject(category) || !Array.isArray(category.components) || !category.components.length || category.components.length > 200) {
          throw new Error(`Class ${classId} contains an incomplete ${categoryKey} grading category.`);
        }
        for (const component of category.components) {
          if (!isPlainObject(component) || !component.id || !SAFE_ID_RE.test(String(component.id))) throw new Error('The data file contains an invalid assessment-component identifier.');
        }
      }
      if (!isPlainObject(cls.scores)) throw new Error(`Class ${classId} has missing score records.`);
      for (const termKey of ['term1','term2','term3']) {
        if (cls.scores[termKey] === undefined) cls.scores[termKey] = {};
        if (!isPlainObject(cls.scores[termKey])) throw new Error(`Class ${classId} has invalid ${termKey} score records.`);
      }
    }
  }
  if (safe.activeId !== undefined && safe.activeId !== null && safe.activeId !== '') {
    if (!SAFE_ID_RE.test(String(safe.activeId))) throw new Error('The data file contains an invalid active class identifier.');
    if (!Object.prototype.hasOwnProperty.call(safe.classes, String(safe.activeId))) throw new Error('The active class identifier does not exist in the class collection.');
  }
  return safe;
}

function safeWriteJsonText(filePath, text, { recoveryPath = null } = {}) {
  const safeObject = parseAndValidateAppState(text);
  const normalized = JSON.stringify(safeObject);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  try {
    if (recoveryPath && fs.existsSync(filePath)) {
      try {
        // Never overwrite a known-good recovery copy with a corrupt primary file.
        parseAndValidateAppState(fs.readFileSync(filePath, 'utf8'));
        fs.copyFileSync(filePath, recoveryPath);
      } catch (err) { console.warn('Primary data file was not eligible to refresh the recovery copy:', err.message); }
    }
    const fd = fs.openSync(tmp, 'w');
    try {
      fs.writeFileSync(fd, normalized, 'utf8');
      fs.fsyncSync(fd);
    } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, filePath);
    const verify = fs.readFileSync(filePath);
    if (crypto.createHash('sha256').update(verify).digest('hex') !== crypto.createHash('sha256').update(Buffer.from(normalized)).digest('hex')) {
      throw new Error('Saved data failed the disk verification check.');
    }
    parseAndValidateAppState(verify.toString('utf8'));
    return normalized;
  } finally {
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch {}
  }
}

function makeDailyBackup(text) {
  const p = ensureDataFolders();
  const date = new Date().toISOString().slice(0, 10);
  const backup = path.join(p.backupDir, `auto-backup-${date}.json`);
  if (!fs.existsSync(backup)) safeWriteJsonText(backup, text);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 980,
    minHeight: 680,
    title: PRODUCT_NAME,
    icon: threadUpdater ? threadUpdater.resolveResource('assets/app.png') : path.join(__dirname, 'assets', 'app.png'),
    backgroundColor: '#F1E9D6',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  const mainFile = threadUpdater ? threadUpdater.resolveResource('app/index.html') : path.join(__dirname, 'app', 'index.html');
  const allowedMainUrl = pathToFileURL(mainFile).href;
  mainWindow.loadFile(mainFile);
  mainWindow.once('ready-to-show', () => mainWindow.show());

  const blockUnexpectedNavigation = (event, url) => {
    if (url === allowedMainUrl || url.startsWith(allowedMainUrl + '#')) return;
    event.preventDefault();
    if (/^https:\/\//i.test(url)) shell.openExternal(url);
  };
  mainWindow.webContents.on('will-navigate', blockUnexpectedNavigation);
  mainWindow.webContents.on('will-redirect', blockUnexpectedNavigation);
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

function printCurrentContents(webContents) {
  return new Promise((resolve) => {
    if (!webContents || webContents.isDestroyed()) {
      resolve({ ok: false, error: 'The application window is not available.' });
      return;
    }

    // Electron does not support Chromium's browser print-preview page.
    // webContents.print() opens the native Windows print dialog instead.
    webContents.print({
      silent: false,
      printBackground: true,
      color: true,
      margins: { marginType: 'default' }
    }, (success, failureReason) => {
      resolve(success
        ? { ok: true }
        : { ok: false, error: failureReason || 'Printing was cancelled or could not be started.' });
    });
  });
}

function buildMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        { label: 'Print', accelerator: 'CmdOrCtrl+P', click: () => { if (mainWindow) printCurrentContents(mainWindow.webContents); } },
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
          label: 'Check Downloaded Updates',
          click: async () => {
            if (!threadUpdater) return;
            const result = await threadUpdater.scanDownloadedUpdates({ quiet: false });
            const info = threadUpdater.info();
            const detail = info.stagedVersion
              ? `Version ${info.stagedVersion} is staged and will become active the next time you normally open the app.`
              : `No newer .ecrupdate package was found in:\n${info.downloadsFolder}`;
            dialog.showMessageBox(mainWindow, {
              type: info.stagedVersion ? 'info' : 'none',
              title: 'Downloaded Updates',
              message: info.stagedVersion ? 'Update ready for next launch' : 'No downloaded update found',
              detail
            });
            return result;
          }
        },
        {
          label: 'Install Local Update File...',
          click: async () => {
            if (!threadUpdater) return;
            const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
              title: 'Select E-Class Record Update',
              properties: ['openFile'],
              filters: [{ name: 'E-Class Record Update', extensions: ['ecrupdate'] }]
            });
            if (canceled || !filePaths[0]) return;
            const result = await threadUpdater.stagePackage(filePaths[0], { quiet: false });
            if (result && result.staged) {
              dialog.showMessageBox(mainWindow, {
                type: 'info',
                title: 'Update staged',
                message: `Version ${result.version} is ready`,
                detail: 'Continue working normally. The update will become active the next time you close and open the app.'
              });
            } else if (result && result.error) {
              dialog.showErrorBox('Could not stage update', result.error);
            }
          }
        },
        {
          label: 'Open Downloads Folder',
          click: () => shell.openPath(app.getPath('downloads'))
        },
        { type: 'separator' },
        {
          label: 'About',
          click: () => {
            const info = threadUpdater ? threadUpdater.info() : { effectiveVersion: app.getVersion(), bootstrapVersion: app.getVersion() };
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: `About ${PRODUCT_NAME}`,
              message: PRODUCT_NAME,
              detail: `Current version ${info.effectiveVersion}\nBootstrap ${info.bootstrapVersion}\n\nOffline-first class record and learner records application.\nDevelopment updates downloaded as .ecrupdate files are applied on the next normal launch.`
            });
          }
        }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

ipcMain.on('data:load-sync', (event) => {
  if (!isTrustedMainSender(event)) { event.returnValue = null; return; }
  const p = ensureDataFolders();
  for (const candidate of [p.dataFile, p.recoveryFile]) {
    try {
      if (!fs.existsSync(candidate)) continue;
      const raw = fs.readFileSync(candidate, 'utf8');
      const safe = parseAndValidateAppState(raw);
      event.returnValue = JSON.stringify(safe);
      if (candidate === p.recoveryFile) console.warn('Loaded previous verified recovery copy because the primary data file was unavailable or invalid.');
      return;
    } catch (err) {
      console.error(`Could not load ${candidate}:`, err.message);
    }
  }
  event.returnValue = null;
});

ipcMain.handle('data:save', async (event, text) => {
  const rejected = rejectUntrustedInvoke(event); if (rejected) return rejected;
  try {
    const p = ensureDataFolders();
    const normalized = safeWriteJsonText(p.dataFile, text, { recoveryPath: p.recoveryFile });
    makeDailyBackup(normalized);
    return { ok: true, path: p.dataFile, bytes: Buffer.byteLength(normalized, 'utf8') };
  } catch (err) {
    console.error('Save failed:', err);
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('backup:export', async (event, text) => {
  const rejected = rejectUntrustedInvoke(event); if (rejected) return rejected;
  try {
    const normalized = JSON.stringify(parseAndValidateAppState(text), null, 2);
    const date = new Date().toISOString().slice(0, 10);
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Export Gradebook Backup',
      defaultPath: path.join(app.getPath('documents'), `eclass-record-backup-${date}.json`),
      filters: [{ name: 'JSON Backup', extensions: ['json'] }]
    });
    if (canceled || !filePath) return { ok: false, cancelled: true };
    safeWriteJsonText(filePath, normalized);
    return { ok: true, path: filePath };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('backup:import', async (event) => {
  const rejected = rejectUntrustedInvoke(event); if (rejected) return rejected;
  try {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: 'Import Gradebook Backup',
      properties: ['openFile'],
      filters: [{ name: 'JSON Backup', extensions: ['json'] }]
    });
    if (canceled || !filePaths[0]) return { cancelled: true };
    const backupStat = fs.statSync(filePaths[0]);
    if (!backupStat.isFile() || backupStat.size > 64 * 1024 * 1024) return { ok: false, error: 'Backup exceeds the 64 MB safety limit.' };
    const raw = fs.readFileSync(filePaths[0], 'utf8');
    const safe = parseAndValidateAppState(raw);
    const text = JSON.stringify(safe);
    return { ok: true, cancelled: false, text, path: filePaths[0] };
  } catch (err) {
    console.error('Backup import failed:', err);
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('print:current', async (event) => {
  const rejected = rejectUntrustedInvoke(event); if (rejected) return rejected;
  return printCurrentContents(event.sender);
});

ipcMain.handle('data:location', async (event) => isTrustedMainSender(event) ? ensureDataFolders().root : null);

ipcMain.handle('sf1:import-official', async (event) => {
  const rejected = rejectUntrustedInvoke(event); if (rejected) return rejected;
  try {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: 'Import Official School Form 1 (SF1)',
      properties: ['openFile'],
      filters: [{ name: 'Official SF1 Excel 97-2004 Workbook', extensions: ['xls'] }]
    });
    if (canceled || !filePaths[0]) return { ok: false, cancelled: true };
    const filePath = filePaths[0];
    const sf1Stat = fs.statSync(filePath);
    if (!sf1Stat.isFile() || sf1Stat.size > MAX_OFFICIAL_IMPORT_BYTES) throw new Error('The SF1 workbook exceeds the 25 MB safety limit.');
    const data = parseOfficialSf1Xls(filePath);
    return { ok: true, path: filePath, fileName: path.basename(filePath), data };
  } catch (err) {
    console.error('Official SF1 import failed:', err);
    return { ok: false, error: err.message };
  }
});



function assertSafeXlsxArchive(zip, label = 'Excel workbook') {
  const entries = zip.getEntries();
  if (entries.length > MAX_XLSX_ENTRIES) throw new Error(`${label} contains too many ZIP entries.`);
  let total = 0;
  for (const entry of entries) {
    const size = Number(entry && entry.header && entry.header.size || 0);
    if (!Number.isFinite(size) || size < 0 || size > MAX_XLSX_ENTRY_BYTES) throw new Error(`${label} contains an unexpectedly large internal file.`);
    total += size;
    if (total > MAX_XLSX_UNCOMPRESSED_BYTES) throw new Error(`${label} expands beyond the 128 MB safety limit.`);
    const name = String(entry.entryName || '').replace(/\\/g, '/');
    if (!name || name.startsWith('/') || /^[A-Za-z]:/.test(name) || name.split('/').includes('..')) throw new Error(`${label} contains an unsafe internal path.`);
  }
}

/* ===== v1.0.7: Import an already-filled Official ECR workbook =============
   The import source is the SAME official ECR .xlsx layout bundled with this
   app. Because the layout is fixed, no CSV/header mapping is needed. We read
   the known cells directly from the XLSX package, then return raw scores and
   metadata to the renderer. The renderer applies those raw scores to the app's
   own grading logic so PS/WS/Initial/Term grades are recalculated normally. */

function xmlDecode(value) {
  return String(value ?? '')
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#([0-9]+);/g, (_m, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function xlsxSharedStrings(zip) {
  const entry = zip.getEntry('xl/sharedStrings.xml');
  if (!entry) return [];
  const xml = entry.getData().toString('utf8');
  const out = [];
  const siRe = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let m;
  while ((m = siRe.exec(xml))) {
    let text = '';
    const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
    let tm;
    while ((tm = tRe.exec(m[1]))) text += xmlDecode(tm[1]);
    out.push(text);
  }
  return out;
}

function worksheetCellParts(xml, ref) {
  const r = regexEscape(ref);
  const selfRe = new RegExp(`<c\\b([^>]*\\br="${r}"[^>]*)\\/>`);
  const self = xml.match(selfRe);
  if (self) return { attrs: self[1] || '', body: '' };
  const fullRe = new RegExp(`<c\\b([^>]*\\br="${r}"[^>]*)>([\\s\\S]*?)<\\/c>`);
  const full = xml.match(fullRe);
  if (full) return { attrs: full[1] || '', body: full[2] || '' };
  return null;
}

function worksheetCellValue(xml, ref, sharedStrings) {
  const cell = worksheetCellParts(xml, ref);
  if (!cell) return '';
  const type = ((cell.attrs.match(/\bt="([^"]+)"/) || [])[1] || '').toLowerCase();
  if (type === 'inlinestr') {
    let text = '';
    const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
    let tm;
    while ((tm = tRe.exec(cell.body))) text += xmlDecode(tm[1]);
    return text;
  }
  const vMatch = cell.body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/);
  if (!vMatch) return '';
  const raw = xmlDecode(vMatch[1]);
  if (type === 's') {
    const i = Number(raw);
    return Number.isInteger(i) && i >= 0 && i < sharedStrings.length ? sharedStrings[i] : '';
  }
  if (type === 'str' || type === 'e') return raw;
  if (type === 'b') return raw === '1';
  if (raw.trim() === '') return '';
  const n = Number(raw);
  return Number.isFinite(n) ? n : raw;
}

function xlsxCellText(xml, ref, sharedStrings) {
  const v = worksheetCellValue(xml, ref, sharedStrings);
  return v === null || v === undefined ? '' : String(v).trim();
}

function xlsxCellNumber(xml, ref, sharedStrings) {
  const v = worksheetCellValue(xml, ref, sharedStrings);
  if (v === '' || v === null || v === undefined) return '';
  const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : '';
}

function normalizeFractionWeight(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n > 1.000001 ? n / 100 : n;
}

function normalizePercentWeight(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n > 0 && n <= 1.000001 ? n * 100 : n;
}

function detectOfficialEcrTerm(headerText, workbookXml) {
  const candidates = [String(headerText || ''), String(workbookXml || '')];
  for (const text of candidates) {
    let m = text.match(/TERM\s*([123])/i);
    if (m) return Number(m[1]);
    if (/FIRST\s+TERM/i.test(text)) return 1;
    if (/SECOND\s+TERM/i.test(text)) return 2;
    if (/THIRD\s+TERM/i.test(text)) return 3;
  }
  return 1;
}

function parseOfficialEcrWorkbook(filePath) {
  const zip = new AdmZip(fs.readFileSync(filePath));
  assertSafeXlsxArchive(zip, 'The ECR workbook');
  const sheetEntry = zip.getEntry('xl/worksheets/sheet1.xml');
  if (!sheetEntry) throw new Error('This workbook does not contain the expected official ECR worksheet.');
  const xml = sheetEntry.getData().toString('utf8');
  const sharedStrings = xlsxSharedStrings(zip);
  const workbookEntry = zip.getEntry('xl/workbook.xml');
  const workbookXml = workbookEntry ? workbookEntry.getData().toString('utf8') : '';

  const title = xlsxCellText(xml, 'B2', sharedStrings);
  const hpsLabel = xlsxCellText(xml, 'B15', sharedStrings);
  const learnersLabel = xlsxCellText(xml, 'B16', sharedStrings);
  if (!/CLASS\s+RECORD/i.test(title) || !/HIGHEST\s+POSSIBLE\s+SCORE/i.test(hpsLabel) || !/LEARNERS/i.test(learnersLabel)) {
    throw new Error('The selected workbook does not match the official ECR template used by this app.');
  }

  const termNo = detectOfficialEcrTerm(title, workbookXml);
  const metaText = (ref, allowNumericZero = false) => {
    const t = xlsxCellText(xml, ref, sharedStrings);
    if (/^#(NAME\?|REF!|N\/A|VALUE!|DIV\/0!)/i.test(t)) return '';
    if (!allowNumericZero && t === '0') return ''; // common unresolved external-link cache
    return t;
  };
  const meta = {
    region: metaText('F5'),
    division: metaText('R5'),
    schoolId: metaText('Z5', true),
    schoolName: metaText('F7'),
    schoolYear: metaText('Z7'),
    gradeLevel: metaText('J10', true),
    teacher: metaText('Q10'),
    subject: metaText('AA10'),
    section: metaText('J11')
  };

  const wwHps = ['F','G','H','I','J'].map(c => xlsxCellNumber(xml, `${c}15`, sharedStrings));
  const ptHps = ['N','O','P'].map(c => xlsxCellNumber(xml, `${c}15`, sharedStrings));
  const exHps = ['T','U','V'].map(c => xlsxCellNumber(xml, `${c}15`, sharedStrings));
  const categories = {
    WW: {
      weight: normalizeFractionWeight(xlsxCellNumber(xml, 'M15', sharedStrings), 0.20),
      hps: wwHps
    },
    PT: {
      weight: normalizeFractionWeight(xlsxCellNumber(xml, 'S15', sharedStrings), 0.50),
      hps: ptHps
    },
    EXAM: {
      weight: normalizeFractionWeight(xlsxCellNumber(xml, 'AA15', sharedStrings), 0.30),
      hps: exHps,
      subWeights: ['W','X','Y'].map(c => normalizePercentWeight(xlsxCellNumber(xml, `${c}15`, sharedStrings), ''))
    }
  };

  const students = [];
  const warnings = [];
  const scoreCols = {
    WW: ['F','G','H','I','J'],
    PT: ['N','O','P'],
    EXAM: ['T','U','V']
  };

  function readStudentRow(row, sex) {
    const name = xlsxCellText(xml, `C${row}`, sharedStrings);
    const scores = {
      WW: scoreCols.WW.map(c => xlsxCellNumber(xml, `${c}${row}`, sharedStrings)),
      PT: scoreCols.PT.map(c => xlsxCellNumber(xml, `${c}${row}`, sharedStrings)),
      EXAM: scoreCols.EXAM.map(c => xlsxCellNumber(xml, `${c}${row}`, sharedStrings))
    };
    const hasScores = [...scores.WW, ...scores.PT, ...scores.EXAM].some(v => v !== '');
    const officialTermGrade = xlsxCellNumber(xml, `AC${row}`, sharedStrings);
    const officialInitialGrade = xlsxCellNumber(xml, `AB${row}`, sharedStrings);
    if (!name) {
      if (hasScores) warnings.push(`Row ${row} contains scores but no learner name, so that row was skipped.`);
      return;
    }
    if (/^#(NAME\?|REF!|N\/A|VALUE!|DIV\/0!)/i.test(name)) {
      warnings.push(`Row ${row} has an unresolved Excel value instead of a learner name, so it was skipped.`);
      return;
    }
    students.push({ name, sex, row, scores, officialInitialGrade, officialTermGrade });
  }

  for (let row = 18; row <= 67; row++) readStudentRow(row, 'M');
  for (let row = 69; row <= 118; row++) readStudentRow(row, 'F');

  if (!students.length) {
    throw new Error('No learner names were found in the official ECR. If the names come from an external linked workbook, open the ECR in Excel with the links available, then Save the workbook before importing it here.');
  }

  return {
    template: 'official-ecr',
    termNo,
    meta,
    categories,
    students,
    warnings
  };
}

ipcMain.handle('ecr:import-official', async (event) => {
  const rejected = rejectUntrustedInvoke(event); if (rejected) return rejected;
  try {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: 'Import Filled Official Class Record',
      properties: ['openFile'],
      filters: [{ name: 'Official ECR Excel Workbook', extensions: ['xlsx'] }]
    });
    if (canceled || !filePaths[0]) return { ok: false, cancelled: true };
    const filePath = filePaths[0];
    const ecrStat = fs.statSync(filePath);
    if (!ecrStat.isFile() || ecrStat.size > MAX_OFFICIAL_IMPORT_BYTES) throw new Error('The ECR workbook exceeds the 25 MB safety limit.');
    const data = parseOfficialEcrWorkbook(filePath);
    return { ok: true, path: filePath, fileName: path.basename(filePath), data };
  } catch (err) {
    console.error('Official ECR import failed:', err);
    return { ok: false, error: err.message };
  }
});


/* ===== v1.0.20: Official output is handled only by main-extension.js. ===== */

ipcMain.handle('update:info', async (event) => {
  const rejected = rejectUntrustedInvoke(event); if (rejected) return rejected;
  return threadUpdater ? threadUpdater.info() : {
  bootstrapVersion: app.getVersion(), effectiveVersion: app.getVersion(), stagedVersion: null
  };
});

ipcMain.handle('update:scan', async (event) => {
  const rejected = rejectUntrustedInvoke(event); if (rejected) return rejected;
  if (!threadUpdater) return { ok: false, error: 'Update service is not ready.' };
  return threadUpdater.scanDownloadedUpdates({ quiet: false });
});

ipcMain.handle('update:choose-file', async (event) => {
  const rejected = rejectUntrustedInvoke(event); if (rejected) return rejected;
  if (!threadUpdater) return { ok: false, error: 'Update service is not ready.' };
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'Select E-Class Record Update',
    properties: ['openFile'],
    filters: [{ name: 'E-Class Record Update', extensions: ['ecrupdate'] }]
  });
  if (canceled || !filePaths[0]) return { ok: false, cancelled: true };
  return threadUpdater.stagePackage(filePaths[0], { quiet: false });
});

const ALLOWED_RUNTIME_ACTIONS = new Set([
  'ecr:official-pdf-preview','ecr:official-popup-preview','ecr:official-save',
  'gs:official-pdf-preview','gs:official-popup-preview','gs:official-save',
  'sf2:official-pdf-preview','sf2:official-popup-preview','sf2:official-save',
  'summary:import-file','sf9:preview-html','window:fullscreen-state','window:exit-fullscreen',
  'ecr:preview-engine-status','official:preview-engine-status'
]);

ipcMain.handle('runtime:invoke', async (event, action, payload) => {
  if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) {
    return { ok: false, error: 'Runtime request rejected from an untrusted window.' };
  }
  if (typeof action !== 'string' || !ALLOWED_RUNTIME_ACTIONS.has(action)) {
    return { ok: false, unsupported: true, error: 'Runtime action is not permitted.' };
  }
  if (payload !== undefined) {
    try {
      const payloadBytes = Buffer.byteLength(JSON.stringify(payload), 'utf8');
      if (payloadBytes > 20 * 1024 * 1024) return { ok: false, error: 'Runtime request exceeds the 20 MB safety limit.' };
    } catch { return { ok: false, error: 'Runtime request payload is not serializable.' }; }
  }
  if (!runtimeExtension || typeof runtimeExtension.invoke !== 'function') {
    return { ok: false, unsupported: true, error: `Runtime action is not available: ${action}` };
  }
  try {
    return await runtimeExtension.invoke(action, payload, {
      app, dialog, shell, fs, path, dataPaths, ensureDataFolders,
      resolveResource: rel => threadUpdater ? threadUpdater.resolveResource(rel) : path.join(__dirname, rel)
    });
  } catch (err) {
    console.error('Runtime extension action failed:', action, err);
    return { ok: false, error: err.message };
  }
});

async function loadRuntimeExtension() {
  runtimeExtension = null;
  if (!threadUpdater) return;
  const extPath = threadUpdater.extensionPath();
  if (!extPath) return;
  try {
    delete require.cache[require.resolve(extPath)];
    const ext = require(extPath);
    if (ext && typeof ext.register === 'function') {
      await ext.register({
        app, BrowserWindow, dialog, ipcMain, Menu, shell, fs, path,
        dataPaths, ensureDataFolders,
        resolveResource: rel => threadUpdater.resolveResource(rel),
        getMainWindow: () => mainWindow
      });
    }
    runtimeExtension = ext || null;
  } catch (err) {
    console.error('Could not load downloaded runtime extension:', err);
    runtimeExtension = null;
  }
}

app.whenReady().then(async () => {
  ensureDataFolders();

  threadUpdater = new ThreadUpdater({
    app,
    AdmZip,
    productName: PRODUCT_NAME,
    appId: APP_ID,
    packagedRoot: __dirname
  });
  await threadUpdater.initialize();
  await loadRuntimeExtension();

  createWindow();
  buildMenu();
  threadUpdater.startWatching({
    intervalMs: 8000,
    onStatus: status => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update:status', status);
      }
    }
  });

  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('before-quit', () => {
  if (threadUpdater) threadUpdater.stopWatching();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
