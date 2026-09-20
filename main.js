const { app, BrowserWindow, dialog, ipcMain, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile, spawn } = require('child_process');
const AdmZip = require('adm-zip');

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

ipcMain.handle('print:current', async (event) => {
  return printCurrentContents(event.sender);
});

ipcMain.handle('data:location', async () => ensureDataFolders().root);



/* ===== v1.0.5: Official ECR template export ==============================
   The official workbook is treated as a read-only master template. We patch
   only worksheet cell values inside a copy of the XLSX ZIP package, preserving
   the template's styles, merged cells, drawings, page setup, margins and print
   layout exactly. The exported workbook contains static values, so it does not
   depend on the template's original external INPUT DATA / HELPER workbook. */
const OFFICIAL_ECR_TEMPLATE = path.join(__dirname, 'templates', 'ECR official Template.xlsx');

function xmlEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function regexEscape(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function setWorksheetCell(xml, ref, value, type = 'auto') {
  const r = regexEscape(ref);
  const fullRe = new RegExp(`<c\\b([^>]*\\br="${r}"[^>]*)>([\\s\\S]*?)<\\/c>`);
  const selfRe = new RegExp(`<c\\b([^>]*\\br="${r}"[^>]*)\\/>`);
  // Check self-closing cells first. A self-closing <c .../> would otherwise
  // be mistaken for the opening tag of a later cell by the full-cell regex.
  let m = xml.match(selfRe);
  let attrs = m ? m[1] : null;
  let matched = m ? m[0] : null;
  if (!m) {
    m = xml.match(fullRe);
    attrs = m ? m[1] : null;
    matched = m ? m[0] : null;
  }
  if (!matched) throw new Error(`Official ECR template cell ${ref} was not found.`);

  const style = (attrs.match(/\bs="([^"]+)"/) || [])[1];
  const styleAttr = style ? ` s="${style}"` : '';
  let replacement;
  const isBlank = value === '' || value === null || value === undefined;
  if (isBlank) {
    replacement = `<c r="${ref}"${styleAttr}/>`;
  } else {
    const numeric = type === 'number' || (type === 'auto' && typeof value === 'number' && Number.isFinite(value));
    if (numeric) {
      const n = Number(value);
      replacement = `<c r="${ref}"${styleAttr}><v>${Number.isFinite(n) ? n : 0}</v></c>`;
    } else {
      replacement = `<c r="${ref}"${styleAttr} t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
    }
  }
  return xml.replace(matched, replacement);
}

function cleanFileName(value) {
  return String(value || 'Class Record')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100) || 'Class Record';
}

function officialTermNumber(termKey) {
  return termKey === 'term2' ? 2 : termKey === 'term3' ? 3 : 1;
}

function buildOfficialEcrBuffer(payload) {
  if (!fs.existsSync(OFFICIAL_ECR_TEMPLATE)) throw new Error('The bundled Official ECR template is missing.');
  if (!payload || !payload.meta || !payload.categories || !Array.isArray(payload.students)) {
    throw new Error('The Class Record data sent to the exporter is incomplete.');
  }

  const male = payload.students.filter(s => s.sex === 'M');
  const female = payload.students.filter(s => s.sex === 'F');
  if (male.length > 50 || female.length > 50) {
    throw new Error('The official template supports up to 50 male and 50 female learners.');
  }
  const ww = payload.categories.WW || {};
  const pt = payload.categories.PT || {};
  const ex = payload.categories.EXAM || {};
  if ((ww.components || []).length !== 5 || (pt.components || []).length !== 3 || (ex.components || []).length !== 3) {
    throw new Error('The official template requires exactly 5 WW, 3 PT and 3 Examination components.');
  }

  const zip = new AdmZip(fs.readFileSync(OFFICIAL_ECR_TEMPLATE));
  const entry = zip.getEntry('xl/worksheets/sheet1.xml');
  if (!entry) throw new Error('The official ECR worksheet was not found in the template.');
  let xml = entry.getData().toString('utf8');
  const meta = payload.meta;
  const termNo = officialTermNumber(payload.termKey);
  const termWords = ['FIRST TERM', 'SECOND TERM', 'THIRD TERM'][termNo - 1];

  // Header and class metadata.
  const headerValues = {
    B2: `CLASS RECORD - TERM ${termNo}`,
    F5: meta.region || '', R5: meta.division || '', Z5: meta.schoolId || '',
    F7: meta.schoolName || '', Z7: meta.schoolYear || '',
    B10: termWords, J10: meta.gradeLevel || '', Q10: meta.teacher || '',
    AA10: meta.subject || '', J11: meta.section || ''
  };
  for (const [ref, value] of Object.entries(headerValues)) xml = setWorksheetCell(xml, ref, value, 'string');

  // Highest Possible Scores and weights from the app's current Class Record setup.
  const hpsMap = {};
  ['F','G','H','I','J'].forEach((c,i)=>hpsMap[`${c}15`] = Number(ww.components[i].hps || 0));
  hpsMap.K15 = ww.components.reduce((a,c)=>a+Number(c.hps||0),0);
  hpsMap.L15 = 100; hpsMap.M15 = Number(ww.weight || 0);
  ['N','O','P'].forEach((c,i)=>hpsMap[`${c}15`] = Number(pt.components[i].hps || 0));
  hpsMap.Q15 = pt.components.reduce((a,c)=>a+Number(c.hps||0),0);
  hpsMap.R15 = 100; hpsMap.S15 = Number(pt.weight || 0);
  ['T','U','V'].forEach((c,i)=>hpsMap[`${c}15`] = Number(ex.components[i].hps || 0));
  ['W','X','Y'].forEach((c,i)=>hpsMap[`${c}15`] = Number(ex.components[i].subWeight || 0));
  hpsMap.Z15 = 100; hpsMap.AA15 = Number(ex.weight || 0);
  for (const [ref, value] of Object.entries(hpsMap)) xml = setWorksheetCell(xml, ref, value, 'number');

  // Clear all learner rows first. This removes the template's external-link
  // formulas and stale cached values so the exported file is fully standalone.
  const valueCols = ['C','F','G','H','I','J','K','L','M','N','O','P','Q','R','S','T','U','V','W','X','Y','Z','AA','AB','AC','AD'];
  const rows = [...Array.from({length:50},(_,i)=>18+i), ...Array.from({length:50},(_,i)=>69+i)];
  for (const row of rows) {
    for (const col of valueCols) xml = setWorksheetCell(xml, `${col}${row}`, '', 'string');
  }

  function writeStudent(row, s) {
    xml = setWorksheetCell(xml, `C${row}`, s.name || '', 'string');
    const wwScores = (s.WW && s.WW.scores) || [];
    const ptScores = (s.PT && s.PT.scores) || [];
    const exScores = (s.EXAM && s.EXAM.scores) || [];
    ['F','G','H','I','J'].forEach((c,i)=>{ xml = setWorksheetCell(xml, `${c}${row}`, wwScores[i], 'number'); });
    xml = setWorksheetCell(xml, `K${row}`, s.WW ? s.WW.total : '', 'number');
    xml = setWorksheetCell(xml, `L${row}`, s.WW ? s.WW.ps : '', 'number');
    xml = setWorksheetCell(xml, `M${row}`, s.WW ? s.WW.ws : '', 'number');
    ['N','O','P'].forEach((c,i)=>{ xml = setWorksheetCell(xml, `${c}${row}`, ptScores[i], 'number'); });
    xml = setWorksheetCell(xml, `Q${row}`, s.PT ? s.PT.total : '', 'number');
    xml = setWorksheetCell(xml, `R${row}`, s.PT ? s.PT.ps : '', 'number');
    xml = setWorksheetCell(xml, `S${row}`, s.PT ? s.PT.ws : '', 'number');
    ['T','U','V'].forEach((c,i)=>{ xml = setWorksheetCell(xml, `${c}${row}`, exScores[i], 'number'); });
    ['W','X','Y'].forEach((c,i)=>{ xml = setWorksheetCell(xml, `${c}${row}`, s.EXAM && s.EXAM.componentPs ? s.EXAM.componentPs[i] : '', 'number'); });
    xml = setWorksheetCell(xml, `Z${row}`, s.EXAM ? s.EXAM.ps : '', 'number');
    xml = setWorksheetCell(xml, `AA${row}`, s.EXAM ? s.EXAM.ws : '', 'number');
    xml = setWorksheetCell(xml, `AB${row}`, s.initial, 'number');
    xml = setWorksheetCell(xml, `AC${row}`, s.term, 'number');
    xml = setWorksheetCell(xml, `AD${row}`, s.descriptor || '', 'string');
  }

  male.forEach((s,i)=>writeStudent(18+i,s));
  female.forEach((s,i)=>writeStudent(69+i,s));

  // There should be no formulas left. Keeping this static is intentional for
  // an official export: what the app calculated is exactly what is filed.
  zip.updateFile('xl/worksheets/sheet1.xml', Buffer.from(xml, 'utf8'));

  // Rename the worksheet to the selected term and remove the source workbook's
  // external-link/calc-chain metadata. This prevents Excel link warnings.
  const wbEntry = zip.getEntry('xl/workbook.xml');
  if (wbEntry) {
    let wbXml = wbEntry.getData().toString('utf8');
    wbXml = wbXml.replace(/TERM 1/g, `TERM ${termNo}`);
    wbXml = wbXml.replace(/<externalReferences>[\s\S]*?<\/externalReferences>/g, '');
    zip.updateFile('xl/workbook.xml', Buffer.from(wbXml, 'utf8'));
  }
  const appPropsEntry = zip.getEntry('docProps/app.xml');
  if (appPropsEntry) {
    let appXml = appPropsEntry.getData().toString('utf8');
    appXml = appXml.replace(/TERM 1/g, `TERM ${termNo}`);
    zip.updateFile('docProps/app.xml', Buffer.from(appXml, 'utf8'));
  }
  const relEntry = zip.getEntry('xl/_rels/workbook.xml.rels');
  if (relEntry) {
    let relXml = relEntry.getData().toString('utf8');
    relXml = relXml.replace(/<Relationship\b[^>]*Type="[^"]*\/externalLink"[^>]*\/>/g, '');
    relXml = relXml.replace(/<Relationship\b[^>]*Type="[^"]*\/calcChain"[^>]*\/>/g, '');
    zip.updateFile('xl/_rels/workbook.xml.rels', Buffer.from(relXml, 'utf8'));
  }
  const ctEntry = zip.getEntry('[Content_Types].xml');
  if (ctEntry) {
    let ctXml = ctEntry.getData().toString('utf8');
    ctXml = ctXml.replace(/<Override\b[^>]*PartName="\/xl\/externalLinks\/externalLink1.xml"[^>]*\/>/g, '');
    ctXml = ctXml.replace(/<Override\b[^>]*PartName="\/xl\/calcChain.xml"[^>]*\/>/g, '');
    zip.updateFile('[Content_Types].xml', Buffer.from(ctXml, 'utf8'));
  }
  zip.deleteFile('xl/externalLinks/externalLink1.xml');
  zip.deleteFile('xl/externalLinks/_rels/externalLink1.xml.rels');
  zip.deleteFile('xl/calcChain.xml');

  return zip.toBuffer();
}

function quotePowerShellLiteral(value) {
  return "'" + String(value).replace(/'/g, "''") + "'";
}

function canUseExcelPrintPreview() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      resolve({ ok: false, error: 'Official ECR Print Preview requires Windows and desktop Microsoft Excel.' });
      return;
    }
    const checkScript = [
      "$ErrorActionPreference='Stop'",
      '$excel=$null',
      'try {',
      '  $excel=New-Object -ComObject Excel.Application',
      '  $excel.Quit()',
      '  [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($excel)',
      '  exit 0',
      '} catch {',
      '  if ($excel -ne $null) { try { $excel.Quit() } catch {} }',
      '  Write-Error $_.Exception.Message',
      '  exit 1',
      '}'
    ].join('; ');
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', checkScript],
      { windowsHide: true, timeout: 15000 },
      (err, _stdout, stderr) => {
        if (err) resolve({ ok: false, error: (stderr || '').trim() || 'Microsoft Excel could not be started.' });
        else resolve({ ok: true });
      });
  });
}

async function openExcelPrintPreview(filePath) {
  const availability = await canUseExcelPrintPreview();
  if (!availability.ok) return availability;

  const scriptPath = path.join(app.getPath('temp'), `eclass-ecr-preview-${Date.now()}.ps1`);
  const psFile = quotePowerShellLiteral(filePath);
  const psScript = [
    "$ErrorActionPreference = 'Stop'",
    '$excel = $null',
    '$workbook = $null',
    '$sheet = $null',
    'try {',
    '  $excel = New-Object -ComObject Excel.Application',
    '  $excel.Visible = $true',
    '  $excel.DisplayAlerts = $false',
    `  $workbook = $excel.Workbooks.Open(${psFile}, 0, $true)`,
    '  $sheet = $workbook.Worksheets.Item(1)',
    '  $sheet.Activate()',
    '  $excel.DisplayAlerts = $true',
    '  $sheet.PrintPreview()',
    '}',
    'catch {',
    '  Add-Type -AssemblyName PresentationFramework -ErrorAction SilentlyContinue',
    '  try { [System.Windows.MessageBox]::Show("Could not open the Official ECR Print Preview.\n\n" + $_.Exception.Message, "E-Class Record App") | Out-Null } catch {}',
    '}',
    'finally {',
    '  if ($workbook -ne $null) { try { $workbook.Close($false) } catch {} }',
    '  if ($excel -ne $null) { try { $excel.Quit() } catch {} }',
    '  if ($sheet -ne $null) { try { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($sheet) } catch {} }',
    '  if ($workbook -ne $null) { try { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($workbook) } catch {} }',
    '  if ($excel -ne $null) { try { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($excel) } catch {} }',
    '  [GC]::Collect()',
    '  [GC]::WaitForPendingFinalizers()',
    '  try { Remove-Item -LiteralPath $PSCommandPath -Force -ErrorAction SilentlyContinue } catch {}',
    '}'
  ].join('\r\n');
  fs.writeFileSync(scriptPath, psScript, 'utf8');

  try {
    const child = spawn('powershell.exe', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', scriptPath], {
      detached: true,
      stdio: 'ignore',
      windowsHide: false
    });
    child.unref();
    return { ok: true, path: filePath, preview: true };
  } catch (err) {
    try { fs.unlinkSync(scriptPath); } catch {}
    return { ok: false, error: err.message };
  }
}

async function saveOfficialEcr(payload, mode = 'save') {
  const buffer = buildOfficialEcrBuffer(payload);
  const termNo = officialTermNumber(payload.termKey);
  const classPart = cleanFileName(payload.meta.className || `${payload.meta.gradeLevel || ''} ${payload.meta.section || ''}`);
  const filename = `${classPart} - Term ${termNo} - Official ECR.xlsx`;

  if (mode === 'preview' || mode === 'open') {
    const p = ensureDataFolders();
    const exportDir = path.join(p.root, 'Official ECR Exports');
    fs.mkdirSync(exportDir, { recursive: true });
    const filePath = path.join(exportDir, filename);
    fs.writeFileSync(filePath, buffer);

    if (mode === 'preview') {
      const previewResult = await openExcelPrintPreview(filePath);
      if (previewResult.ok) return previewResult;
      const openError = await shell.openPath(filePath);
      return {
        ok: false,
        previewUnavailable: true,
        openedFallback: !openError,
        path: filePath,
        error: previewResult.error || openError || 'Microsoft Excel Print Preview is unavailable.'
      };
    }

    const error = await shell.openPath(filePath);
    if (error) return { ok: false, error };
    return { ok: true, path: filePath, opened: true };
  }

  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Save Official Class Record',
    defaultPath: path.join(app.getPath('documents'), filename),
    filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }]
  });
  if (canceled || !filePath) return { ok: false, cancelled: true };
  fs.writeFileSync(filePath, buffer);
  return { ok: true, path: filePath };
}


ipcMain.handle('ecr:export-official', async (_event, payload, mode) => {
  try { return await saveOfficialEcr(payload, mode || 'save'); }
  catch (err) { console.error('Official ECR export failed:', err); return { ok: false, error: err.message }; }
});

app.whenReady().then(() => {
  ensureDataFolders();
  createWindow();
  buildMenu();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
