'use strict';

// v1.0.12 runtime extension
// Official ECR preview pipeline:
// official template -> direct XLSX fill -> Excel PDF render -> in-app popup.
// Excel is no longer used to write worksheet cells. It is used only to render
// the completed official workbook, avoiding merged-cell/type-conversion COM errors.

let startupContext = null;
const previewWindows = new Set();

function cleanFileName(value) {
  return String(value || 'Class Record')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100) || 'Class Record';
}

function termNumber(termKey) {
  return termKey === 'term2' ? 2 : termKey === 'term3' ? 3 : 1;
}

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
  const isBlank = value === '' || value === null || value === undefined;
  let replacement;
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

function validatePayload(payload) {
  if (!payload || !payload.meta || !payload.categories || !Array.isArray(payload.students)) {
    throw new Error('The Class Record data sent to the Official ECR preview is incomplete.');
  }
  const male = payload.students.filter(s => s.sex === 'M');
  const female = payload.students.filter(s => s.sex === 'F');
  if (male.length > 50 || female.length > 50) {
    throw new Error('The official ECR template supports up to 50 male and 50 female learners.');
  }
  const ww = payload.categories.WW || {};
  const pt = payload.categories.PT || {};
  const ex = payload.categories.EXAM || {};
  if ((ww.components || []).length !== 5 || (pt.components || []).length !== 3 || (ex.components || []).length !== 3) {
    throw new Error('The official ECR template requires exactly 5 WW, 3 PT and 3 Examination components.');
  }
}

function resolveAdmZip() {
  try {
    if (require.main && typeof require.main.require === 'function') return require.main.require('adm-zip');
  } catch {}
  try { return require('adm-zip'); } catch {}
  throw new Error('The workbook ZIP engine is unavailable in this installation.');
}

function buildOfficialEcrBuffer(payload, ctx) {
  validatePayload(payload);
  const { fs, resolveResource } = ctx;
  const AdmZip = resolveAdmZip();
  const officialTemplate = resolveResource('templates/ECR official Template.xlsx');
  if (!fs.existsSync(officialTemplate)) throw new Error('The bundled Official ECR template is missing.');

  const ww = payload.categories.WW || {};
  const pt = payload.categories.PT || {};
  const ex = payload.categories.EXAM || {};
  const zip = new AdmZip(fs.readFileSync(officialTemplate));
  const entry = zip.getEntry('xl/worksheets/sheet1.xml');
  if (!entry) throw new Error('The official ECR worksheet was not found in the template.');
  let xml = entry.getData().toString('utf8');
  const meta = payload.meta;
  const termNo = termNumber(payload.termKey);
  const termWords = ['FIRST TERM', 'SECOND TERM', 'THIRD TERM'][termNo - 1];

  const headerValues = {
    B2: `CLASS RECORD - TERM ${termNo}`,
    F5: meta.region || '', R5: meta.division || '', Z5: meta.schoolId || '',
    F7: meta.schoolName || '', Z7: meta.schoolYear || '',
    B10: termWords, J10: meta.gradeLevel || '', Q10: meta.teacher || '',
    AA10: meta.subject || '', J11: meta.section || ''
  };
  for (const [ref, value] of Object.entries(headerValues)) xml = setWorksheetCell(xml, ref, value, 'string');

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

  payload.students.filter(s=>s.sex==='M').forEach((s,i)=>writeStudent(18+i,s));
  payload.students.filter(s=>s.sex==='F').forEach((s,i)=>writeStudent(69+i,s));

  zip.updateFile('xl/worksheets/sheet1.xml', Buffer.from(xml, 'utf8'));

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

function execPowerShell(scriptPath, args) {
  const { execFile } = require('child_process');
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, ...args],
      { windowsHide: true, timeout: 90000, maxBuffer: 1024 * 1024 * 4 },
      (err, stdout, stderr) => {
        if (err) {
          resolve({ ok: false, error: String((stderr || stdout || err.message || '')).trim() || 'Microsoft Excel could not render the preview.' });
        } else {
          resolve({ ok: true, stdout: String(stdout || '').trim() });
        }
      }
    );
  });
}

function buildRenderOnlyPowerShell() {
  return String.raw`param(
  [Parameter(Mandatory=$true)][string]$XlsxPath,
  [Parameter(Mandatory=$true)][string]$PdfPath
)
$ErrorActionPreference = 'Stop'
$excel = $null
$workbook = $null
$sheet = $null
try {
  $xlsx = [string]$XlsxPath
  $pdf = [string]$PdfPath
  $excel = New-Object -ComObject Excel.Application
  $excel.Visible = $false
  $excel.DisplayAlerts = $false
  try { $excel.AskToUpdateLinks = $false } catch {}

  $workbook = $excel.Workbooks.Open($xlsx, 0, $true)
  $sheet = $workbook.Worksheets.Item(1)
  [void]$sheet.ExportAsFixedFormat(0, $pdf)

  $workbook.Close($false)
  $workbook = $null
  $excel.Quit()
  $excel = $null
  Write-Output 'OK'
  exit 0
}
catch {
  $msg = $_.Exception.Message
  try { if ($workbook -ne $null) { $workbook.Close($false) } } catch {}
  try { if ($excel -ne $null) { $excel.Quit() } } catch {}
  Write-Error $msg
  exit 1
}
finally {
  if ($sheet -ne $null) { try { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($sheet) } catch {} }
  if ($workbook -ne $null) { try { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($workbook) } catch {} }
  if ($excel -ne $null) { try { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($excel) } catch {} }
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}`;
}

function openPdfPopup(pdfPath, xlsxPath, payload, ctx) {
  const { BrowserWindow, Menu, shell, getMainWindow } = ctx;
  if (!BrowserWindow) throw new Error('The in-app preview window service is unavailable.');
  const { pathToFileURL } = require('url');
  const parent = typeof getMainWindow === 'function' ? getMainWindow() : null;
  const termNo = termNumber(payload.termKey);
  const className = payload.meta && payload.meta.className ? payload.meta.className : 'Class Record';

  const win = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 900,
    minHeight: 650,
    parent: parent && !parent.isDestroyed() ? parent : undefined,
    modal: false,
    title: `Official ECR Print Preview — ${className} — Term ${termNo}`,
    backgroundColor: '#525659',
    show: false,
    autoHideMenuBar: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      plugins: true
    }
  });
  previewWindows.add(win);

  const doPrint = () => {
    if (win.isDestroyed()) return;
    win.webContents.print({
      silent: false,
      printBackground: true,
      color: true,
      margins: { marginType: 'default' }
    });
  };

  if (Menu) {
    const menu = Menu.buildFromTemplate([
      {
        label: 'File',
        submenu: [
          { label: 'Print...', accelerator: 'CmdOrCtrl+P', click: doPrint },
          { label: 'Open Official Workbook in Excel', click: () => shell.openPath(xlsxPath) },
          { type: 'separator' },
          { label: 'Close Preview', accelerator: 'Esc', click: () => { if (!win.isDestroyed()) win.close(); } }
        ]
      },
      {
        label: 'View',
        submenu: [
          { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' },
          { type: 'separator' }, { role: 'togglefullscreen' }
        ]
      }
    ]);
    win.setMenu(menu);
  }

  win.webContents.on('did-fail-load', (_event, code, desc) => {
    if (code === -3) return;
    console.error('Official ECR popup preview failed to load:', code, desc);
  });
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => previewWindows.delete(win));
  win.loadURL(pathToFileURL(pdfPath).href);
  return win;
}

async function createOfficialPopupPreview(payload, context) {
  const ctx = { ...(startupContext || {}), ...(context || {}) };
  validatePayload(payload);
  if (process.platform !== 'win32') {
    return { ok: false, previewUnavailable: true, error: 'Official ECR preview requires Windows and desktop Microsoft Excel.' };
  }

  const { app, fs, path, dataPaths } = ctx;
  const root = dataPaths().root;
  const previewDir = path.join(root, 'Official ECR Previews');
  fs.mkdirSync(previewDir, { recursive: true });

  const termNo = termNumber(payload.termKey);
  const classPart = cleanFileName(payload.meta.className || `${payload.meta.gradeLevel || ''} ${payload.meta.section || ''}`);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const base = `${classPart} - Term ${termNo} - Official ECR Preview - ${stamp}`;
  const xlsxPath = path.join(previewDir, `${base}.xlsx`);
  const pdfPath = path.join(previewDir, `${base}.pdf`);
  const scriptPath = path.join(app.getPath('temp'), `eclass-ecr-render-${Date.now()}-${process.pid}.ps1`);

  const buffer = buildOfficialEcrBuffer(payload, ctx);
  fs.writeFileSync(xlsxPath, buffer);
  fs.writeFileSync(scriptPath, buildRenderOnlyPowerShell(), 'utf8');

  try {
    const ps = await execPowerShell(scriptPath, [xlsxPath, pdfPath]);
    if (!ps.ok || !fs.existsSync(pdfPath)) {
      return {
        ok: false,
        previewUnavailable: true,
        openedFallback: false,
        xlsxPath,
        pdfPath,
        error: ps.error || 'Microsoft Excel did not create the official ECR PDF preview.'
      };
    }

    openPdfPopup(pdfPath, xlsxPath, payload, ctx);

    try {
      const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
      for (const name of fs.readdirSync(previewDir)) {
        const p = path.join(previewDir, name);
        if (p === xlsxPath || p === pdfPath) continue;
        try {
          const st = fs.statSync(p);
          if (st.isFile() && st.mtimeMs < cutoff) fs.unlinkSync(p);
        } catch {}
      }
    } catch {}

    return { ok: true, preview: true, inAppPopup: true, xlsxPath, pdfPath };
  } finally {
    try { fs.unlinkSync(scriptPath); } catch {}
  }
}

module.exports = {
  async register(context) {
    startupContext = context;
  },

  async invoke(action, payload, context) {
    if (action === 'ecr:official-pdf-preview' || action === 'ecr:official-popup-preview') {
      return createOfficialPopupPreview(payload, context);
    }
    return { ok: false, unsupported: true, error: `Runtime action is not available in v1.0.12: ${action}` };
  }
};
