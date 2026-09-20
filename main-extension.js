'use strict';

// v1.0.11 runtime patch: merged-cell-safe Official ECR print preview.
// It fills a fresh copy of the supplied official Excel template through
// Microsoft Excel COM automation, exports that exact sheet to PDF using the
// template's own print area/page setup, and opens the PDF in Windows' default
// PDF viewer.  This avoids Electron/Chromium print-preview limitations.

const { execFile } = require('child_process');

let startupContext = null;

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

function validatePayload(payload) {
  if (!payload || !payload.meta || !payload.categories || !Array.isArray(payload.students)) {
    throw new Error('The Class Record data sent to the Official ECR preview is incomplete.');
  }
  const ww = payload.categories.WW || {};
  const pt = payload.categories.PT || {};
  const ex = payload.categories.EXAM || {};
  if ((ww.components || []).length !== 5 || (pt.components || []).length !== 3 || (ex.components || []).length !== 3) {
    throw new Error('The official ECR template requires exactly 5 WW, 3 PT and 3 Examination components.');
  }
  const male = payload.students.filter(s => s.sex === 'M');
  const female = payload.students.filter(s => s.sex === 'F');
  if (male.length > 50 || female.length > 50) {
    throw new Error('The official ECR template supports up to 50 male and 50 female learners.');
  }
}

function execPowerShell(scriptPath, args, timeoutMs = 90000) {
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, ...args],
      { windowsHide: true, timeout: timeoutMs, maxBuffer: 1024 * 1024 * 4 },
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

function buildPowerShellScript() {
  // Keep the cell map here explicit: these are the cells in the supplied
  // official ECR workbook, not a recreated HTML form.
  return String.raw`param(
  [Parameter(Mandatory=$true)][string]$JsonPath,
  [Parameter(Mandatory=$true)][string]$XlsxPath,
  [Parameter(Mandatory=$true)][string]$PdfPath
)
$ErrorActionPreference = 'Stop'
$excel = $null
$workbook = $null
$sheet = $null
try {
  $data = Get-Content -LiteralPath $JsonPath -Raw -Encoding UTF8 | ConvertFrom-Json
  $excel = New-Object -ComObject Excel.Application
  $excel.Visible = $false
  $excel.DisplayAlerts = $false
  try { $excel.AskToUpdateLinks = $false } catch {}

  # UpdateLinks=0 prevents the supplied template's old helper-workbook links
  # from being refreshed while opening the local copy.
  $workbook = $excel.Workbooks.Open($XlsxPath, 0, $false)
  $sheet = $workbook.Worksheets.Item(1)

  # Make the generated workbook self-contained where Excel exposes the links.
  try {
    $links = $workbook.LinkSources(1)
    if ($null -ne $links) {
      foreach ($link in @($links)) {
        try { $workbook.BreakLink($link, 1) } catch {}
      }
    }
  } catch {}

  function Set-Cell([string]$Ref, $Value) {
    $r = $null
    $merge = $null
    $anchor = $null
    try {
      $r = $sheet.Range($Ref)
      $isMerged = $false
      try { $isMerged = [bool]$r.MergeCells } catch {}

      if ($isMerged) {
        # Excel COM rejects ClearContents/assignment when only part of a merged
        # area is targeted. Work with the complete MergeArea and write through
        # its top-left anchor cell instead.
        $merge = $r.MergeArea
        if ($null -eq $Value -or [string]::IsNullOrWhiteSpace([string]$Value)) {
          [void]$merge.ClearContents()
        } else {
          $anchor = $merge.Cells.Item(1, 1)
          $anchor.Value2 = $Value
        }
      } else {
        if ($null -eq $Value -or [string]::IsNullOrWhiteSpace([string]$Value)) {
          [void]$r.ClearContents()
        } else {
          $r.Value2 = $Value
        }
      }
    }
    finally {
      if ($anchor -ne $null) { try { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($anchor) } catch {} }
      if ($merge -ne $null) { try { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($merge) } catch {} }
      if ($r -ne $null) { try { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($r) } catch {} }
    }
  }

  $termNo = 1
  if ($data.termKey -eq 'term2') { $termNo = 2 }
  elseif ($data.termKey -eq 'term3') { $termNo = 3 }
  $termWords = @('FIRST TERM','SECOND TERM','THIRD TERM')[$termNo - 1]
  try { $sheet.Name = "TERM $termNo" } catch {}

  # Header / class metadata.
  Set-Cell 'B2'  "CLASS RECORD - TERM $termNo"
  Set-Cell 'F5'  $data.meta.region
  Set-Cell 'R5'  $data.meta.division
  Set-Cell 'Z5'  $data.meta.schoolId
  Set-Cell 'F7'  $data.meta.schoolName
  Set-Cell 'Z7'  $data.meta.schoolYear
  Set-Cell 'B10' $termWords
  Set-Cell 'J10' $data.meta.gradeLevel
  Set-Cell 'Q10' $data.meta.teacher
  Set-Cell 'AA10' $data.meta.subject
  Set-Cell 'J11' $data.meta.section

  $ww = $data.categories.WW
  $pt = $data.categories.PT
  $ex = $data.categories.EXAM

  $wwCols = @('F','G','H','I','J')
  $ptCols = @('N','O','P')
  $exCols = @('T','U','V')
  $exPsCols = @('W','X','Y')

  $wwHpsTotal = 0.0
  for ($i=0; $i -lt 5; $i++) {
    $h = [double]$ww.components[$i].hps
    Set-Cell ($wwCols[$i] + '15') $h
    $wwHpsTotal += $h
  }
  Set-Cell 'K15' $wwHpsTotal
  Set-Cell 'L15' 100
  Set-Cell 'M15' ([double]$ww.weight)

  $ptHpsTotal = 0.0
  for ($i=0; $i -lt 3; $i++) {
    $h = [double]$pt.components[$i].hps
    Set-Cell ($ptCols[$i] + '15') $h
    $ptHpsTotal += $h
  }
  Set-Cell 'Q15' $ptHpsTotal
  Set-Cell 'R15' 100
  Set-Cell 'S15' ([double]$pt.weight)

  for ($i=0; $i -lt 3; $i++) {
    Set-Cell ($exCols[$i] + '15') ([double]$ex.components[$i].hps)
    Set-Cell ($exPsCols[$i] + '15') ([double]$ex.components[$i].subWeight)
  }
  Set-Cell 'Z15' 100
  Set-Cell 'AA15' ([double]$ex.weight)

  # Remove old external formulas/cached learner values from all official
  # learner rows before inserting this class' values.
  foreach ($r in 18..67) {
    # C:E is merged in each official learner-name row, so clear it through the
    # merge-aware helper rather than clearing C alone.
    Set-Cell ("C$r") $null
    [void]$sheet.Range("F$r:AD$r").ClearContents()
  }
  foreach ($r in 69..118) {
    Set-Cell ("C$r") $null
    [void]$sheet.Range("F$r:AD$r").ClearContents()
  }

  function Write-Learner($s, [int]$row) {
    Set-Cell ("C$row") $s.name
    for ($i=0; $i -lt 5; $i++) { Set-Cell ($wwCols[$i] + $row) $s.WW.scores[$i] }
    Set-Cell ("K$row") $s.WW.total
    Set-Cell ("L$row") $s.WW.ps
    Set-Cell ("M$row") $s.WW.ws

    for ($i=0; $i -lt 3; $i++) { Set-Cell ($ptCols[$i] + $row) $s.PT.scores[$i] }
    Set-Cell ("Q$row") $s.PT.total
    Set-Cell ("R$row") $s.PT.ps
    Set-Cell ("S$row") $s.PT.ws

    for ($i=0; $i -lt 3; $i++) {
      Set-Cell ($exCols[$i] + $row) $s.EXAM.scores[$i]
      Set-Cell ($exPsCols[$i] + $row) $s.EXAM.componentPs[$i]
    }
    Set-Cell ("Z$row") $s.EXAM.ps
    Set-Cell ("AA$row") $s.EXAM.ws
    Set-Cell ("AB$row") $s.initial
    Set-Cell ("AC$row") $s.term
    Set-Cell ("AD$row") $s.descriptor
  }

  $maleRow = 18
  foreach ($s in @($data.students | Where-Object { $_.sex -eq 'M' })) {
    Write-Learner $s $maleRow
    $maleRow++
  }
  $femaleRow = 69
  foreach ($s in @($data.students | Where-Object { $_.sex -eq 'F' })) {
    Write-Learner $s $femaleRow
    $femaleRow++
  }

  $workbook.Save()

  # Render the actual official sheet using Excel's rendering engine.  The
  # existing PrintArea, orientation, scaling, margins, drawings and styles in
  # the supplied template are preserved and therefore reflected in the PDF.
  $sheet.ExportAsFixedFormat(0, $PdfPath, 0, $true, $false)

  $workbook.Close($false)
  $workbook = $null
  $excel.Quit()
  $excel = $null
  Write-Output 'OK'
  exit 0
}
catch {
  try { if ($workbook -ne $null) { $workbook.Close($false) } } catch {}
  try { if ($excel -ne $null) { $excel.Quit() } } catch {}
  Write-Error $_.Exception.ToString()
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

async function createOfficialPdfPreview(payload, context) {
  validatePayload(payload);
  if (process.platform !== 'win32') {
    return { ok: false, previewUnavailable: true, error: 'Official ECR PDF preview requires Windows and desktop Microsoft Excel.' };
  }

  const { app, fs, path, shell, dataPaths, resolveResource } = context;
  const templatePath = resolveResource('templates/ECR official Template.xlsx');
  if (!fs.existsSync(templatePath)) throw new Error('The bundled Official ECR template is missing.');

  const root = dataPaths().root;
  const previewDir = path.join(root, 'Official ECR Previews');
  fs.mkdirSync(previewDir, { recursive: true });

  // Avoid file-lock conflicts with a previously opened preview by generating a
  // fresh timestamped official workbook/PDF pair each time.
  const termNo = termNumber(payload.termKey);
  const classPart = cleanFileName(payload.meta.className || `${payload.meta.gradeLevel || ''} ${payload.meta.section || ''}`);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const base = `${classPart} - Term ${termNo} - Official ECR Preview - ${stamp}`;
  const xlsxPath = path.join(previewDir, `${base}.xlsx`);
  const pdfPath = path.join(previewDir, `${base}.pdf`);
  const jsonPath = path.join(app.getPath('temp'), `eclass-ecr-preview-${Date.now()}-${process.pid}.json`);
  const scriptPath = path.join(app.getPath('temp'), `eclass-ecr-preview-${Date.now()}-${process.pid}.ps1`);

  fs.copyFileSync(templatePath, xlsxPath);
  fs.writeFileSync(jsonPath, JSON.stringify(payload), 'utf8');
  fs.writeFileSync(scriptPath, buildPowerShellScript(), 'utf8');

  try {
    const ps = await execPowerShell(scriptPath, [jsonPath, xlsxPath, pdfPath]);
    if (!ps.ok || !fs.existsSync(pdfPath)) {
      const fallbackError = await shell.openPath(xlsxPath);
      return {
        ok: false,
        previewUnavailable: true,
        openedFallback: !fallbackError,
        xlsxPath,
        pdfPath,
        error: ps.error || fallbackError || 'Microsoft Excel did not create the PDF preview.'
      };
    }

    const openError = await shell.openPath(pdfPath);
    if (openError) {
      const fallbackError = await shell.openPath(xlsxPath);
      return {
        ok: false,
        previewUnavailable: true,
        openedFallback: !fallbackError,
        xlsxPath,
        pdfPath,
        error: `The PDF was created but Windows could not open it automatically: ${openError}`
      };
    }

    // Remove old timestamped preview pairs after a week so the data folder does
    // not grow forever.  Never remove the preview just opened.
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

    return { ok: true, preview: true, xlsxPath, pdfPath };
  } finally {
    try { fs.unlinkSync(jsonPath); } catch {}
    try { fs.unlinkSync(scriptPath); } catch {}
  }
}

module.exports = {
  async register(context) {
    startupContext = context;
  },

  async invoke(action, payload, context) {
    const ctx = context || startupContext;
    if (action === 'ecr:official-pdf-preview') {
      return createOfficialPdfPreview(payload, ctx);
    }
    return { ok: false, unsupported: true, error: `Runtime action is not available in v1.0.11: ${action}` };
  }
};
