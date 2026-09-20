'use strict';

// v1.0.15 runtime extension
// Official ECR preview pipeline:
// official template -> direct XLSX fill -> persistent hidden Excel renderer -> cached PDF -> in-app popup.
// Excel is pre-warmed once in the background and reused. Preview PDFs are content-addressed,
// so unchanged Class Records reopen almost instantly without another Excel render.

let startupContext = null;
const previewWindows = new Set();
let excelEngine = null;
let templateFingerprintCache = null;

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

function setWorksheetRowHidden(xml, rowNumber, hidden) {
  const rowRe = new RegExp(`<row\\b([^>]*\\br="${rowNumber}"[^>]*)>`);
  const m = xml.match(rowRe);
  if (!m) return xml;
  let attrs = m[1];
  attrs = attrs.replace(/\shidden="[^"]*"/g, '');
  if (hidden) attrs += ' hidden="1"';
  return xml.replace(m[0], `<row${attrs}>`);
}

function compactUnusedLearnerRows(xml, payload) {
  // The official ECR has fixed learner blocks:
  // Male = rows 18-67, Female separator = row 68, Female = rows 69-118.
  // For the official preview/print copy, hide unused rows so the Female block follows the
  // last populated Male learner immediately and trailing empty Female rows are skipped.
  const maleCount = payload.students.filter(s => s.sex === 'M').length;
  const femaleCount = payload.students.filter(s => s.sex === 'F').length;

  for (let row = 18; row <= 67; row++) {
    const used = row < 18 + maleCount;
    xml = setWorksheetRowHidden(xml, row, !used);
  }
  for (let row = 69; row <= 118; row++) {
    const used = row < 69 + femaleCount;
    xml = setWorksheetRowHidden(xml, row, !used);
  }
  // Never hide the official Female section divider/header row.
  xml = setWorksheetRowHidden(xml, 68, false);
  return xml;
}


function ensureMergedRange(xml, ref) {
  if (new RegExp(`<mergeCell\\s+ref="${regexEscape(ref)}"\\s*/>`).test(xml)) return xml;
  const re = /<mergeCells count="(\d+)">([\s\S]*?)<\/mergeCells>/;
  const hit = xml.match(re);
  if (hit) {
    const count = Number(hit[1] || 0);
    return xml.replace(hit[0], `<mergeCells count="${count + 1}">${hit[2]}<mergeCell ref="${ref}"/></mergeCells>`);
  }
  return xml.replace(/<pageMargins\b/, `<mergeCells count="1"><mergeCell ref="${ref}"/></mergeCells><pageMargins`);
}

function addEcrSignatureStyles(zip) {
  const entry = zip.getEntry('xl/styles.xml');
  if (!entry) throw new Error('The official ECR style table was not found.');
  let styles = entry.getData().toString('utf8');
  const borders = styles.match(/<borders count="(\d+)">([\s\S]*?)<\/borders>/);
  const xfs = styles.match(/<cellXfs count="(\d+)">([\s\S]*?)<\/cellXfs>/);
  if (!borders || !xfs) throw new Error('The official ECR styles could not be extended for the Subject Teacher signatory.');
  const borderId = Number(borders[1]);
  const borderXml = '<border><left/><right/><top/><bottom style="thin"><color rgb="FF000000"/></bottom><diagonal/></border>';
  styles = styles.replace(borders[0], `<borders count="${borderId + 1}">${borders[2]}${borderXml}</borders>`);

  const firstStyle = Number(xfs[1]);
  const nameStyle = firstStyle;
  const titleStyle = firstStyle + 1;
  const nameXf = `<xf numFmtId="0" fontId="3" fillId="0" borderId="${borderId}" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>`;
  const titleXf = '<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>';
  styles = styles.replace(xfs[0], `<cellXfs count="${firstStyle + 2}">${xfs[2]}${nameXf}${titleXf}</cellXfs>`);
  zip.updateFile('xl/styles.xml', Buffer.from(styles, 'utf8'));
  return { nameStyle, titleStyle };
}

function setWorksheetCellStyle(xml, ref, styleId) {
  const r = regexEscape(ref);
  const re = new RegExp(`<c\\b([^>]*\\br="${r}"[^>]*)`);
  const hit = xml.match(re);
  if (!hit) throw new Error(`Template cell ${ref} was not found while formatting a signatory.`);
  let attrs = hit[1].replace(/\s+s="[^"]*"/g, '');
  attrs += ` s="${styleId}"`;
  return xml.replace(hit[0], `<c${attrs}`);
}

function addEcrSubjectTeacherSignatory(buffer, payload, ctx) {
  const AdmZip = resolveAdmZip();
  const zip = new AdmZip(buffer);
  const sheetEntry = zip.getEntry('xl/worksheets/sheet1.xml');
  if (!sheetEntry) throw new Error('The official ECR worksheet was not found while adding the Subject Teacher signatory.');
  let xml = sheetEntry.getData().toString('utf8');
  const styles = addEcrSignatureStyles(zip);
  const meta = payload.meta || {};
  const preparedName = meta.preparedByName || meta.teacher || '';
  const preparedTitle = meta.preparedByTitle || 'Subject Teacher';

  xml = ensureMergedRange(xml, 'C119:H119');
  xml = ensureMergedRange(xml, 'C120:H120');
  xml = setWorksheetCell(xml, 'B119', 'Prepared by:', 'string');
  xml = setWorksheetCell(xml, 'C119', preparedName, 'string');
  xml = setWorksheetCellStyle(xml, 'C119', styles.nameStyle);
  xml = setWorksheetCell(xml, 'C120', preparedTitle, 'string');
  xml = setWorksheetCellStyle(xml, 'C120', styles.titleStyle);
  zip.updateFile('xl/worksheets/sheet1.xml', Buffer.from(xml, 'utf8'));
  return zip.toBuffer();
}

function stripWorkbookExternalLinks(zip) {
  const wbEntry = zip.getEntry('xl/workbook.xml');
  if (wbEntry) {
    let wbXml = wbEntry.getData().toString('utf8');
    wbXml = wbXml.replace(/<externalReferences>[\s\S]*?<\/externalReferences>/g, '');
    zip.updateFile('xl/workbook.xml', Buffer.from(wbXml, 'utf8'));
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
    ctXml = ctXml.replace(/<Override\b[^>]*PartName="\/xl\/externalLinks\/[^"]+"[^>]*\/>/g, '');
    ctXml = ctXml.replace(/<Override\b[^>]*PartName="\/xl\/calcChain.xml"[^>]*\/>/g, '');
    zip.updateFile('[Content_Types].xml', Buffer.from(ctXml, 'utf8'));
  }
  for (const entry of zip.getEntries()) {
    if (entry.entryName.startsWith('xl/externalLinks/')) zip.deleteFile(entry.entryName);
  }
  zip.deleteFile('xl/calcChain.xml');
}

function replacePngMediaFromDataUri(zip, entryName, dataUri) {
  const m = String(dataUri || '').match(/^data:image\/png;base64,(.+)$/i);
  if (!m) return;
  try {
    const buf = Buffer.from(m[1], 'base64');
    if (buf.length > 100) zip.updateFile(entryName, buf);
  } catch {}
}

function divisionHeading(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  return /^division\s+of\s+/i.test(text) ? text.toUpperCase() : `DIVISION OF ${text.toUpperCase()}`;
}

function compactUnusedGsLearnerRows(xml, payload) {
  // Official GS: Male = 16-65, Female header = 66, Female = 67-116.
  const maleCount = payload.students.filter(s => s.sex === 'M').length;
  const femaleCount = payload.students.filter(s => s.sex === 'F').length;
  for (let row = 16; row <= 65; row++) xml = setWorksheetRowHidden(xml, row, !(row < 16 + maleCount));
  for (let row = 67; row <= 116; row++) xml = setWorksheetRowHidden(xml, row, !(row < 67 + femaleCount));
  xml = setWorksheetRowHidden(xml, 66, false);
  return xml;
}

function buildOfficialGsBuffer(payload, ctx) {
  validatePayload(payload);
  const { fs, resolveResource } = ctx;
  const AdmZip = resolveAdmZip();
  const officialTemplate = resolveResource('templates/GS official Template.xlsx');
  if (!fs.existsSync(officialTemplate)) throw new Error('The bundled Official Grading Sheet template is missing.');

  const zip = new AdmZip(fs.readFileSync(officialTemplate));
  const entry = zip.getEntry('xl/worksheets/sheet1.xml');
  if (!entry) throw new Error('The official Grading Sheet worksheet was not found in the template.');
  let xml = entry.getData().toString('utf8');
  const meta = payload.meta || {};
  const ww = payload.categories.WW || {};
  const pt = payload.categories.PT || {};
  const ex = payload.categories.EXAM || {};
  const termNo = termNumber(payload.termKey);
  const termWords = ['FIRST TERM', 'SECOND TERM', 'THIRD TERM'][termNo - 1];

  // Only official data-bearing cells are changed. Static headings/labels,
  // merged ranges, sizing, formatting, logos/positions, and page setup remain.
  const headerValues = {
    A2: meta.region || '',
    A3: divisionHeading(meta.division),
    A4: meta.schoolName || '',
    A5: meta.schoolId ? `SCHOOL ID: ${meta.schoolId}` : 'SCHOOL ID:',
    A6: meta.schoolYear ? `School Year ${meta.schoolYear}` : 'School Year',
    E8: meta.section || '',
    S8: meta.adviser || '',
    AC8: meta.subject || '',
    B10: termWords
  };
  for (const [ref, value] of Object.entries(headerValues)) xml = setWorksheetCell(xml, ref, value, 'string');

  const hpsMap = {};
  ['F','G','H','I','J'].forEach((c,i)=>hpsMap[`${c}13`] = Number(ww.components[i].hps || 0));
  hpsMap.K13 = ww.components.reduce((a,c)=>a+Number(c.hps||0),0);
  hpsMap.L13 = 100; hpsMap.M13 = Number(ww.weight || 0);
  ['N','O','P'].forEach((c,i)=>hpsMap[`${c}13`] = Number(pt.components[i].hps || 0));
  hpsMap.Q13 = pt.components.reduce((a,c)=>a+Number(c.hps||0),0);
  hpsMap.R13 = 100; hpsMap.S13 = Number(pt.weight || 0);
  ['T','U','V'].forEach((c,i)=>hpsMap[`${c}13`] = Number(ex.components[i].hps || 0));
  ['W','X','Y'].forEach((c,i)=>hpsMap[`${c}13`] = Number(ex.components[i].subWeight || 0));
  hpsMap.Z13 = 100; hpsMap.AA13 = Number(ex.weight || 0);
  for (const [ref, value] of Object.entries(hpsMap)) xml = setWorksheetCell(xml, ref, value, 'number');

  const valueCols = ['C','F','G','H','I','J','K','L','M','N','O','P','Q','R','S','T','U','V','W','X','Y','Z','AA','AB','AC','AD'];
  const rows = [...Array.from({length:50},(_,i)=>16+i), ...Array.from({length:50},(_,i)=>67+i)];
  for (const row of rows) for (const col of valueCols) xml = setWorksheetCell(xml, `${col}${row}`, '', 'string');

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

  payload.students.filter(s=>s.sex==='M').forEach((s,i)=>writeStudent(16+i,s));
  payload.students.filter(s=>s.sex==='F').forEach((s,i)=>writeStudent(67+i,s));

  const preparedName = meta.preparedByName || meta.teacher || '';
  const preparedTitle = meta.preparedByTitle || 'Subject Teacher';
  xml = setWorksheetCell(xml, 'C120', preparedName, 'string');
  xml = setWorksheetCell(xml, 'C121', preparedTitle, 'string');
  xml = setWorksheetCell(xml, 'M120', meta.checkedByName || '', 'string');
  xml = setWorksheetCell(xml, 'M121', meta.checkedByTitle || '', 'string');
  xml = setWorksheetCell(xml, 'Z120', meta.approvedByName || '', 'string');
  xml = setWorksheetCell(xml, 'Z121', meta.approvedByTitle || '', 'string');

  xml = compactUnusedGsLearnerRows(xml, payload);
  zip.updateFile('xl/worksheets/sheet1.xml', Buffer.from(xml, 'utf8'));

  // The uploaded GS template uses its first image as the school logo and its
  // second image as the fixed DepEd seal. Replace only the school logo image.
  replacePngMediaFromDataUri(zip, 'xl/media/image1.png', payload.schoolLogoDataUri);

  const wbEntry = zip.getEntry('xl/workbook.xml');
  if (wbEntry) {
    let wbXml = wbEntry.getData().toString('utf8');
    wbXml = wbXml.replace(/GS TERM 1/g, `GS TERM ${termNo}`);
    zip.updateFile('xl/workbook.xml', Buffer.from(wbXml, 'utf8'));
  }
  const appPropsEntry = zip.getEntry('docProps/app.xml');
  if (appPropsEntry) {
    let appXml = appPropsEntry.getData().toString('utf8');
    appXml = appXml.replace(/GS TERM 1/g, `GS TERM ${termNo}`);
    zip.updateFile('docProps/app.xml', Buffer.from(appXml, 'utf8'));
  }
  stripWorkbookExternalLinks(zip);
  return zip.toBuffer();
}

function buildOfficialDocumentBuffer(kind, payload, ctx) {
  if (kind === 'gs') return buildOfficialGsBuffer(payload, ctx);
  return addEcrSubjectTeacherSignatory(buildOfficialEcrBuffer(payload, ctx), payload, ctx);
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

  // Compact the official preview/print copy by hiding only unused learner rows.
  // Hidden rows retain their original cells/formulas/formatting, so the official
  // template itself is not structurally rewritten.
  xml = compactUnusedLearnerRows(xml, payload);

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


function buildPersistentExcelServerPowerShell() {
  return String.raw`$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$excel = $null
function Send-EcrMessage([hashtable]$obj) {
  $json = $obj | ConvertTo-Json -Compress -Depth 6
  [Console]::Out.WriteLine('@@ECR@@' + $json)
  [Console]::Out.Flush()
}
try {
  $excel = New-Object -ComObject Excel.Application
  $excel.Visible = $false
  $excel.DisplayAlerts = $false
  try { $excel.AskToUpdateLinks = $false } catch {}
  try { $excel.ScreenUpdating = $false } catch {}
  try { $excel.EnableEvents = $false } catch {}
  try { $excel.AutomationSecurity = 3 } catch {}
  Send-EcrMessage @{ type='ready'; ok=$true }

  while (($line = [Console]::In.ReadLine()) -ne $null) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    $req = $null
    try {
      $req = $line | ConvertFrom-Json
      $cmd = [string]$req.cmd
      $id = [string]$req.id
      if ($cmd -eq 'quit') { break }
      if ($cmd -eq 'ping') {
        Send-EcrMessage @{ type='response'; id=$id; ok=$true; pong=$true }
        continue
      }
      if ($cmd -eq 'render') {
        $workbook = $null
        $sheet = $null
        try {
          $xlsx = [string]$req.xlsxPath
          $pdf = [string]$req.pdfPath
          if (Test-Path -LiteralPath $pdf) { Remove-Item -LiteralPath $pdf -Force -ErrorAction SilentlyContinue }
          $workbook = $excel.Workbooks.Open($xlsx, 0, $true)
          $sheet = $workbook.Worksheets.Item(1)
          [void]$sheet.ExportAsFixedFormat(0, $pdf)
          $workbook.Close($false)
          [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($sheet)
          [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($workbook)
          $sheet = $null
          $workbook = $null
          Send-EcrMessage @{ type='response'; id=$id; ok=$true; pdfPath=$pdf }
        }
        catch {
          $msg = $_.Exception.Message
          try { if ($workbook -ne $null) { $workbook.Close($false) } } catch {}
          if ($sheet -ne $null) { try { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($sheet) } catch {} }
          if ($workbook -ne $null) { try { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($workbook) } catch {} }
          $sheet = $null
          $workbook = $null
          Send-EcrMessage @{ type='response'; id=$id; ok=$false; error=$msg }
        }
        continue
      }
      Send-EcrMessage @{ type='response'; id=$id; ok=$false; error=('Unknown Excel renderer command: ' + $cmd) }
    }
    catch {
      $msg = $_.Exception.Message
      $id = ''
      try { if ($req -ne $null) { $id = [string]$req.id } } catch {}
      Send-EcrMessage @{ type='response'; id=$id; ok=$false; error=$msg }
    }
  }
}
catch {
  Send-EcrMessage @{ type='ready'; ok=$false; error=$_.Exception.Message }
}
finally {
  try { if ($excel -ne $null) { $excel.Quit() } } catch {}
  if ($excel -ne $null) { try { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($excel) } catch {} }
  $excel = $null
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}`;
}

class PersistentExcelRenderer {
  constructor(ctx) {
    this.ctx = ctx;
    this.proc = null;
    this.scriptPath = null;
    this.ready = false;
    this.startPromise = null;
    this.pending = new Map();
    this.seq = 0;
    this.stdoutBuffer = '';
    this.stderrBuffer = '';
    this.stopping = false;
  }

  async start() {
    if (process.platform !== 'win32') throw new Error('Microsoft Excel rendering is available on Windows only.');
    if (this.ready && this.proc && !this.proc.killed) return true;
    if (this.startPromise) return this.startPromise;

    const { app, fs, path } = this.ctx;
    const { spawn } = require('child_process');
    this.stopping = false;
    this.scriptPath = path.join(app.getPath('temp'), `eclass-excel-render-server-${process.pid}.ps1`);
    fs.writeFileSync(this.scriptPath, buildPersistentExcelServerPowerShell(), 'utf8');

    this.startPromise = new Promise((resolve, reject) => {
      let settled = false;
      const settleOk = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(true);
      };
      const settleErr = (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      };

      const proc = spawn('powershell.exe', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', this.scriptPath], {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe']
      });
      this.proc = proc;
      proc.stdin.setDefaultEncoding('utf8');
      proc.stdout.setEncoding('utf8');
      proc.stderr.setEncoding('utf8');

      proc.stdout.on('data', chunk => this._onStdout(chunk, settleOk, settleErr));
      proc.stderr.on('data', chunk => { this.stderrBuffer = (this.stderrBuffer + chunk).slice(-8192); });
      proc.on('error', err => {
        this.ready = false;
        this.proc = null;
        settleErr(err);
        this._rejectAll(err);
      });
      proc.on('exit', (code) => {
        const wasStopping = this.stopping;
        this.ready = false;
        this.proc = null;
        this.startPromise = null;
        const detail = this.stderrBuffer.trim();
        const err = new Error(wasStopping ? 'Excel renderer stopped.' : (detail || `Excel renderer exited with code ${code}.`));
        if (!wasStopping) settleErr(err);
        this._rejectAll(err);
      });

      const timer = setTimeout(() => {
        try { proc.kill(); } catch {}
        settleErr(new Error('Microsoft Excel took too long to start.'));
      }, 20000);
    }).finally(() => { this.startPromise = null; });

    return this.startPromise;
  }

  _onStdout(chunk, settleOk, settleErr) {
    this.stdoutBuffer += chunk;
    let nl;
    while ((nl = this.stdoutBuffer.indexOf('\n')) >= 0) {
      const raw = this.stdoutBuffer.slice(0, nl).replace(/\r$/, '');
      this.stdoutBuffer = this.stdoutBuffer.slice(nl + 1);
      if (!raw.startsWith('@@ECR@@')) continue;
      let msg;
      try { msg = JSON.parse(raw.slice(7)); } catch { continue; }
      if (msg.type === 'ready') {
        if (msg.ok) {
          this.ready = true;
          settleOk();
        } else {
          this.ready = false;
          settleErr(new Error(msg.error || 'Microsoft Excel could not be started.'));
        }
        continue;
      }
      if (msg.type === 'response' && msg.id) {
        const item = this.pending.get(String(msg.id));
        if (!item) continue;
        this.pending.delete(String(msg.id));
        clearTimeout(item.timer);
        if (msg.ok) item.resolve(msg);
        else item.reject(new Error(msg.error || 'Microsoft Excel could not render the preview.'));
      }
    }
  }

  _rejectAll(err) {
    for (const item of this.pending.values()) {
      clearTimeout(item.timer);
      item.reject(err);
    }
    this.pending.clear();
  }

  async request(cmd, data = {}, timeoutMs = 90000) {
    await this.start();
    if (!this.proc || !this.ready || this.proc.killed) throw new Error('The Microsoft Excel preview engine is not ready.');
    const id = `${process.pid}-${Date.now()}-${++this.seq}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('Microsoft Excel took too long to render the official form preview.'));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.proc.stdin.write(JSON.stringify({ id, cmd, ...data }) + '\n', 'utf8');
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err);
      }
    });
  }

  async render(xlsxPath, pdfPath) {
    try {
      return await this.request('render', { xlsxPath, pdfPath });
    } catch (firstErr) {
      // If the hidden Excel worker died, restart it once transparently.
      this.ready = false;
      if (this.proc) { try { this.proc.kill(); } catch {} }
      this.proc = null;
      this.startPromise = null;
      try {
        await this.start();
        return await this.request('render', { xlsxPath, pdfPath });
      } catch (secondErr) {
        throw secondErr && secondErr.message ? secondErr : firstErr;
      }
    }
  }

  stop() {
    this.stopping = true;
    if (this.proc && !this.proc.killed) {
      try { this.proc.stdin.write(JSON.stringify({ cmd: 'quit' }) + '\n', 'utf8'); } catch {}
      const p = this.proc;
      setTimeout(() => { try { if (p && !p.killed) p.kill(); } catch {} }, 2500).unref?.();
    }
    this.ready = false;
    this._rejectAll(new Error('Excel renderer stopped.'));
    if (this.scriptPath) {
      const { fs } = this.ctx;
      setTimeout(() => { try { fs.unlinkSync(this.scriptPath); } catch {} }, 3000).unref?.();
    }
  }
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}';
}

function templateFingerprint(ctx) {
  const { fs, resolveResource } = ctx;
  const templatePath = resolveResource('templates/ECR official Template.xlsx');
  const stat = fs.statSync(templatePath);
  const key = `${templatePath}|${stat.size}|${stat.mtimeMs}`;
  if (templateFingerprintCache && templateFingerprintCache.key === key) return templateFingerprintCache.hash;
  const crypto = require('crypto');
  const hash = crypto.createHash('sha256').update(fs.readFileSync(templatePath)).digest('hex');
  templateFingerprintCache = { key, hash };
  return hash;
}


let gsTemplateFingerprintCache = null;
function gsTemplateFingerprint(ctx) {
  const { fs, resolveResource } = ctx;
  const templatePath = resolveResource('templates/GS official Template.xlsx');
  const stat = fs.statSync(templatePath);
  const key = `${templatePath}|${stat.size}|${stat.mtimeMs}`;
  if (gsTemplateFingerprintCache && gsTemplateFingerprintCache.key === key) return gsTemplateFingerprintCache.hash;
  const crypto = require('crypto');
  const hash = crypto.createHash('sha256').update(fs.readFileSync(templatePath)).digest('hex');
  gsTemplateFingerprintCache = { key, hash };
  return hash;
}

function gsPreviewSignature(payload, ctx) {
  const crypto = require('crypto');
  return crypto.createHash('sha256')
    .update('gs-preview-v1.0.15-official-template-setup-signatories-compact\n')
    .update(gsTemplateFingerprint(ctx))
    .update('\n')
    .update(stableStringify(payload))
    .digest('hex');
}

function previewSignature(payload, ctx) {
  const crypto = require('crypto');
  return crypto.createHash('sha256')
    .update('ecr-preview-v1.0.15-subject-teacher-signatory\n')
    .update(templateFingerprint(ctx))
    .update('\n')
    .update(stableStringify(payload))
    .digest('hex');
}

function isUsablePreviewFile(fs, filePath) {
  try {
    const st = fs.statSync(filePath);
    return st.isFile() && st.size > 500;
  } catch { return false; }
}

async function fallbackOneShotRender(xlsxPath, pdfPath, ctx) {
  const { app, fs, path } = ctx;
  const scriptPath = path.join(app.getPath('temp'), `eclass-ecr-render-fallback-${Date.now()}-${process.pid}.ps1`);
  fs.writeFileSync(scriptPath, buildRenderOnlyPowerShell(), 'utf8');
  try {
    return await execPowerShell(scriptPath, [xlsxPath, pdfPath]);
  } finally {
    try { fs.unlinkSync(scriptPath); } catch {}
  }
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

  const { fs, path, dataPaths } = ctx;
  const root = dataPaths().root;
  const previewDir = path.join(root, 'Official ECR Preview Cache');
  fs.mkdirSync(previewDir, { recursive: true });

  const termNo = termNumber(payload.termKey);
  const classPart = cleanFileName(payload.meta.className || `${payload.meta.gradeLevel || ''} ${payload.meta.section || ''}`);
  const signature = previewSignature(payload, ctx);
  const shortSig = signature.slice(0, 20);
  const base = `${classPart} - Term ${termNo} - ${shortSig}`;
  const xlsxPath = path.join(previewDir, `${base}.xlsx`);
  const pdfPath = path.join(previewDir, `${base}.pdf`);

  // Content-addressed cache: if the class/term payload and official template are
  // unchanged, the exact previously rendered PDF is reopened immediately.
  if (isUsablePreviewFile(fs, xlsxPath) && isUsablePreviewFile(fs, pdfPath)) {
    openPdfPopup(pdfPath, xlsxPath, payload, ctx);
    return { ok: true, preview: true, inAppPopup: true, cached: true, signature, xlsxPath, pdfPath };
  }

  const buffer = buildOfficialDocumentBuffer('ecr', payload, ctx);
  fs.writeFileSync(xlsxPath, buffer);

  let renderError = null;
  try {
    if (!excelEngine) excelEngine = new PersistentExcelRenderer(ctx);
    await excelEngine.render(xlsxPath, pdfPath);
  } catch (err) {
    renderError = err;
    // Keep a conservative one-shot fallback so preview still works if the
    // persistent worker was blocked by local Excel/PowerShell state.
    const fallback = await fallbackOneShotRender(xlsxPath, pdfPath, ctx);
    if (!fallback.ok) {
      return {
        ok: false,
        previewUnavailable: true,
        openedFallback: false,
        xlsxPath,
        pdfPath,
        error: fallback.error || (renderError && renderError.message) || 'Microsoft Excel did not create the official ECR PDF preview.'
      };
    }
  }

  if (!isUsablePreviewFile(fs, pdfPath)) {
    return {
      ok: false,
      previewUnavailable: true,
      openedFallback: false,
      xlsxPath,
      pdfPath,
      error: 'Microsoft Excel completed without producing a usable official ECR PDF preview.'
    };
  }

  openPdfPopup(pdfPath, xlsxPath, payload, ctx);

  // Remove stale cached previews after 14 days. Current content-addressed files
  // remain untouched and unchanged previews continue to open instantly.
  try {
    const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
    for (const name of fs.readdirSync(previewDir)) {
      const p = path.join(previewDir, name);
      if (p === xlsxPath || p === pdfPath) continue;
      try {
        const st = fs.statSync(p);
        if (st.isFile() && st.mtimeMs < cutoff) fs.unlinkSync(p);
      } catch {}
    }
  } catch {}

  return { ok: true, preview: true, inAppPopup: true, cached: false, signature, xlsxPath, pdfPath };
}

function openGsPdfPopup(pdfPath, xlsxPath, payload, ctx) {
  const { BrowserWindow, Menu, shell, getMainWindow } = ctx;
  if (!BrowserWindow) throw new Error('The in-app preview window service is unavailable.');
  const { pathToFileURL } = require('url');
  const parent = typeof getMainWindow === 'function' ? getMainWindow() : null;
  const termNo = termNumber(payload.termKey);
  const className = payload.meta && payload.meta.className ? payload.meta.className : 'Grading Sheet';

  const win = new BrowserWindow({
    width: 1280, height: 900, minWidth: 900, minHeight: 650,
    parent: parent && !parent.isDestroyed() ? parent : undefined,
    modal: false,
    title: `Official Grading Sheet Print Preview — ${className} — Term ${termNo}`,
    backgroundColor: '#525659', show: false, autoHideMenuBar: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, plugins: true }
  });
  previewWindows.add(win);
  const doPrint = () => {
    if (win.isDestroyed()) return;
    win.webContents.print({ silent: false, printBackground: true, color: true, margins: { marginType: 'default' } });
  };
  if (Menu) {
    const menu = Menu.buildFromTemplate([
      { label: 'File', submenu: [
        { label: 'Print...', accelerator: 'CmdOrCtrl+P', click: doPrint },
        { label: 'Open Official Grading Sheet in Excel', click: () => shell.openPath(xlsxPath) },
        { type: 'separator' },
        { label: 'Close Preview', accelerator: 'Esc', click: () => { if (!win.isDestroyed()) win.close(); } }
      ]},
      { label: 'View', submenu: [
        { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' },
        { type: 'separator' }, { role: 'togglefullscreen' }
      ]}
    ]);
    win.setMenu(menu);
  }
  win.webContents.on('did-fail-load', (_event, code, desc) => {
    if (code === -3) return;
    console.error('Official GS popup preview failed to load:', code, desc);
  });
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => previewWindows.delete(win));
  win.loadURL(pathToFileURL(pdfPath).href);
  return win;
}

async function createOfficialGsPopupPreview(payload, context) {
  const ctx = { ...(startupContext || {}), ...(context || {}) };
  validatePayload(payload);
  if (process.platform !== 'win32') return { ok: false, previewUnavailable: true, error: 'Official Grading Sheet preview requires Windows and desktop Microsoft Excel.' };
  const { fs, path, dataPaths } = ctx;
  const root = dataPaths().root;
  const previewDir = path.join(root, 'Official GS Preview Cache');
  fs.mkdirSync(previewDir, { recursive: true });

  const termNo = termNumber(payload.termKey);
  const classPart = cleanFileName(payload.meta.className || `${payload.meta.gradeLevel || ''} ${payload.meta.section || ''}`);
  const signature = gsPreviewSignature(payload, ctx);
  const shortSig = signature.slice(0, 20);
  const base = `${classPart} - Term ${termNo} - GS - ${shortSig}`;
  const xlsxPath = path.join(previewDir, `${base}.xlsx`);
  const pdfPath = path.join(previewDir, `${base}.pdf`);

  if (isUsablePreviewFile(fs, xlsxPath) && isUsablePreviewFile(fs, pdfPath)) {
    openGsPdfPopup(pdfPath, xlsxPath, payload, ctx);
    return { ok: true, preview: true, inAppPopup: true, cached: true, signature, xlsxPath, pdfPath };
  }

  fs.writeFileSync(xlsxPath, buildOfficialDocumentBuffer('gs', payload, ctx));
  let renderError = null;
  try {
    if (!excelEngine) excelEngine = new PersistentExcelRenderer(ctx);
    await excelEngine.render(xlsxPath, pdfPath);
  } catch (err) {
    renderError = err;
    const fallback = await fallbackOneShotRender(xlsxPath, pdfPath, ctx);
    if (!fallback.ok) return { ok: false, previewUnavailable: true, openedFallback: false, xlsxPath, pdfPath, error: fallback.error || (renderError && renderError.message) || 'Microsoft Excel did not create the official Grading Sheet PDF preview.' };
  }
  if (!isUsablePreviewFile(fs, pdfPath)) return { ok: false, previewUnavailable: true, openedFallback: false, xlsxPath, pdfPath, error: 'Microsoft Excel completed without producing a usable official Grading Sheet PDF preview.' };
  openGsPdfPopup(pdfPath, xlsxPath, payload, ctx);

  try {
    const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
    for (const name of fs.readdirSync(previewDir)) {
      const p = path.join(previewDir, name);
      if (p === xlsxPath || p === pdfPath) continue;
      try { const st = fs.statSync(p); if (st.isFile() && st.mtimeMs < cutoff) fs.unlinkSync(p); } catch {}
    }
  } catch {}
  return { ok: true, preview: true, inAppPopup: true, cached: false, signature, xlsxPath, pdfPath };
}

async function saveOfficialDocument(kind, payload, context) {
  const ctx = { ...(startupContext || {}), ...(context || {}) };
  validatePayload(payload);
  const { app, dialog, fs, path, getMainWindow } = ctx;
  if (!dialog || typeof dialog.showSaveDialog !== 'function') throw new Error('The Windows Save dialog is unavailable.');
  const termNo = termNumber(payload.termKey);
  const classPart = cleanFileName(payload.meta.className || `${payload.meta.gradeLevel || ''} ${payload.meta.section || ''}`);
  const label = kind === 'gs' ? 'Official GS' : 'Official ECR';
  const defaultName = `${classPart} - Term ${termNo} - ${label}.xlsx`;
  const parent = typeof getMainWindow === 'function' ? getMainWindow() : undefined;
  const result = await dialog.showSaveDialog(parent, {
    title: kind === 'gs' ? 'Save Official Grading Sheet' : 'Save Official Class Record',
    defaultPath: path.join(app.getPath('documents'), defaultName),
    filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }]
  });
  if (result.canceled || !result.filePath) return { ok: false, cancelled: true };
  const buffer = buildOfficialDocumentBuffer(kind, payload, ctx);
  fs.writeFileSync(result.filePath, buffer);
  return { ok: true, path: result.filePath, xlsxPath: result.filePath };
}


module.exports = {
  async register(context) {
    startupContext = context;

    // Pre-warm Excel quietly in the background. Do not delay the main app
    // window if Excel itself takes a few seconds to initialize.
    if (process.platform === 'win32') {
      excelEngine = new PersistentExcelRenderer(context);
      setTimeout(() => {
        if (!excelEngine) return;
        excelEngine.start()
          .then(() => console.log('Official form Excel preview engine is warm.'))
          .catch(err => console.warn('Official form Excel preview pre-warm failed:', err.message));
      }, 700);
    }

    if (context.app && typeof context.app.on === 'function') {
      context.app.on('before-quit', () => {
        try { if (excelEngine) excelEngine.stop(); } catch {}
      });
    }
  },

  async invoke(action, payload, context) {
    if (action === 'ecr:official-pdf-preview' || action === 'ecr:official-popup-preview') {
      return createOfficialPopupPreview(payload, context);
    }
    if (action === 'ecr:official-save') return saveOfficialDocument('ecr', payload, context);
    if (action === 'gs:official-pdf-preview' || action === 'gs:official-popup-preview') {
      return createOfficialGsPopupPreview(payload, context);
    }
    if (action === 'gs:official-save') return saveOfficialDocument('gs', payload, context);
    if (action === 'ecr:preview-engine-status' || action === 'official:preview-engine-status') {
      return { ok: true, warm: !!(excelEngine && excelEngine.ready) };
    }
    return { ok: false, unsupported: true, error: `Runtime action is not available in v1.0.15: ${action}` };
  }
};

