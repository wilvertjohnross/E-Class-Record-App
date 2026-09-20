'use strict';

// v1.0.20 bundled runtime extension
// Official ECR preview pipeline:
// official template -> direct XLSX fill -> persistent hidden Excel renderer -> cached PDF -> in-app popup.
// Excel is pre-warmed once in the background and reused. Preview PDFs are content-addressed,
// so unchanged Class Records reopen almost instantly without another Excel render.

let startupContext = null;
const previewWindows = new Set();
let excelEngine = null;
let templateFingerprintCache = null;
let sf2TemplateFingerprintCache = null;

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
  if (!matched) throw new Error(`Official template cell ${ref} was not found.`);

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


function compactUnusedSf2LearnerRows(xml, payload) {
  // Keep the official fixed-row template untouched on disk; only generated copies hide
  // unused learner rows so print/preview height follows the current SF1/current roster.
  const maleCount = payload.students.filter(s => s.sex === 'M').length;
  const femaleCount = payload.students.filter(s => s.sex === 'F').length;
  for (let row = 14; row <= 34; row++) xml = setWorksheetRowHidden(xml, row, row >= 14 + maleCount);
  for (let row = 36; row <= 60; row++) xml = setWorksheetRowHidden(xml, row, row >= 36 + femaleCount);
  xml = setWorksheetRowHidden(xml, 35, false);
  xml = setWorksheetRowHidden(xml, 61, false);
  xml = setWorksheetRowHidden(xml, 62, false);
  return xml;
}

function sf2WorksheetGeometry(xml) {
  const fmt = xml.match(/<sheetFormatPr\b([^>]*)\/?\s*>/);
  const fmtAttrs = fmt ? fmt[1] : '';
  const defaultRowPt = Number((fmtAttrs.match(/\bdefaultRowHeight="([^"]+)"/) || [])[1] || 15);
  const defaultColWidth = Number((fmtAttrs.match(/\bdefaultColWidth="([^"]+)"/) || [])[1] || 8.43);
  const colWidths = new Array(36).fill(defaultColWidth);
  const colsMatch = xml.match(/<cols>([\s\S]*?)<\/cols>/);
  if (colsMatch) {
    const re = /<col\b([^>]*)\/?\s*>/g; let m;
    while ((m = re.exec(colsMatch[1]))) {
      const a = m[1];
      const min = Number((a.match(/\bmin="(\d+)"/) || [])[1] || 0);
      const max = Number((a.match(/\bmax="(\d+)"/) || [])[1] || 0);
      const width = Number((a.match(/\bwidth="([^"]+)"/) || [])[1] || defaultColWidth);
      if (!min || !max || !Number.isFinite(width)) continue;
      for (let c = Math.max(1,min); c <= Math.min(36,max); c++) colWidths[c-1] = width;
    }
  }
  const rowHeights = new Array(100).fill(defaultRowPt);
  const rowHidden = new Array(100).fill(false);
  const rr = /<row\b([^>]*\br="(\d+)"[^>]*)>/g; let rm;
  while ((rm = rr.exec(xml))) {
    const attrs = rm[1], r = Number(rm[2]);
    if (!r || r > rowHeights.length) continue;
    const ht = Number((attrs.match(/\bht="([^"]+)"/) || [])[1] || defaultRowPt);
    if (Number.isFinite(ht)) rowHeights[r-1] = ht;
    rowHidden[r-1] = /\bhidden="(?:1|true)"/.test(attrs);
  }
  const colPx = colWidths.map(w => Math.max(1, Math.floor(((256*w + Math.floor(128/7))/256)*7)));
  const colEmu = colPx.map(px => px * 9525);
  const rawRowEmu = rowHeights.map(pt => Math.max(1, Math.round(pt * 12700)));
  const rowEmu = rawRowEmu.map((h,i) => rowHidden[i] ? 0 : h);
  return { colEmu, rowEmu, rawRowEmu };
}

function sf2AppendComplianceMarks(zip, worksheetXml, marks) {
  if (!marks.length) return;
  const entry = zip.getEntry('xl/drawings/drawing1.xml');
  if (!entry) throw new Error('The official SF2 drawing layer was not found.');
  let drawing = entry.getData().toString('utf8');
  if (!/<xdr:wsDr\b/.test(drawing)) throw new Error('The official SF2 drawing layer is invalid.');
  let nextId = 1;
  drawing.replace(/<xdr:cNvPr\b[^>]*\bid="(\d+)"/g, (_m,id) => { nextId = Math.max(nextId, Number(id)+1); return _m; });
  const g = sf2WorksheetGeometry(worksheetXml);
  const prefix = arr => { const out=[0]; for(const v of arr) out.push(out[out.length-1]+v); return out; };
  const xPos = prefix(g.colEmu), yPos = prefix(g.rowEmu);
  const colToIndex = ref => columnIndexFromRef(ref);
  const rowFromRef = ref => Number((String(ref).match(/(\d+)$/)||[])[1]||0);
  const anchor = (col,row,fromRowOff,toRow,toRowOff) =>
    `<xdr:from><xdr:col>${col}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${row}</xdr:row><xdr:rowOff>${fromRowOff}</xdr:rowOff></xdr:from>`+
    `<xdr:to><xdr:col>${col+1}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${toRow}</xdr:row><xdr:rowOff>${toRowOff}</xdr:rowOff></xdr:to>`;
  const triangleShape = (id,name,x,y,w,h,upper) => {
    // The official cells already contain a dashed diagonal from bottom-left to top-right.
    // Shade one of the two triangles formed by that existing diagonal; do not introduce a
    // horizontal half-cell split.
    const pts = upper
      ? ['0,0','21600,0','0,21600']
      : ['0,21600','21600,0','21600,21600'];
    const path = `<a:moveTo><a:pt x="${pts[0].split(',')[0]}" y="${pts[0].split(',')[1]}"/></a:moveTo>`+
      pts.slice(1).map(pt=>{const [px,py]=pt.split(',');return `<a:lnTo><a:pt x="${px}" y="${py}"/></a:lnTo>`;}).join('')+
      `<a:close/>`;
    return `<xdr:sp macro="" textlink=""><xdr:nvSpPr><xdr:cNvPr id="${id}" name="${xmlEscape(name)}"/><xdr:cNvSpPr/></xdr:nvSpPr>`+
      `<xdr:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm>`+
      `<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="0" t="0" r="r" b="b"/>`+
      `<a:pathLst><a:path w="21600" h="21600">${path}</a:path></a:pathLst></a:custGeom>`+
      `<a:solidFill><a:srgbClr val="000000"/></a:solidFill><a:ln><a:noFill/></a:ln></xdr:spPr></xdr:sp>`;
  };
  const lineShape = (id,name,x,y,w,h) =>
    `<xdr:sp macro="" textlink=""><xdr:nvSpPr><xdr:cNvPr id="${id}" name="${xmlEscape(name)}"/><xdr:cNvSpPr/></xdr:nvSpPr>`+
    // DrawingML's unflipped line preset runs from top-left to bottom-right. That is the
    // opposite of the template's existing dashed diagonal and therefore completes the X.
    `<xdr:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm><a:prstGeom prst="line"><a:avLst/></a:prstGeom><a:noFill/><a:ln w="12700"><a:solidFill><a:srgbClr val="000000"/></a:solidFill><a:prstDash val="solid"/></a:ln></xdr:spPr></xdr:sp>`;
  const additions=[];
  for (const item of marks) {
    const ref=String(item.ref||''), mark=String(item.mark||'P').toUpperCase();
    const col=colToIndex(ref), r1=rowFromRef(ref), row=r1-1;
    if (col < 0 || r1 < 1 || !['A','L','C'].includes(mark)) continue;
    const fullH = g.rawRowEmu[row] || 278765;
    const x = xPos[col] || 0, y = yPos[row] || 0, w = g.colEmu[col] || 300000;
    const a1=anchor(col,row,0,row+1,0);
    if (mark === 'A') {
      // Keep the official dashed bottom-left -> top-right diagonal already in the cell and
      // add only the opposite top-left -> bottom-right stroke to form an X.
      additions.push(`<xdr:twoCellAnchor editAs="twoCell">${a1}${lineShape(nextId++,`SF2 Absent ${ref} opposite diagonal`,x,y,w,fullH)}<xdr:clientData/></xdr:twoCellAnchor>`);
    } else if (mark === 'L') {
      // Upper triangular half, using the template's own diagonal as the dividing edge.
      additions.push(`<xdr:twoCellAnchor editAs="twoCell">${a1}${triangleShape(nextId++,`SF2 Late Comer ${ref} upper diagonal half`,x,y,w,fullH,true)}<xdr:clientData/></xdr:twoCellAnchor>`);
    } else if (mark === 'C') {
      // Lower triangular half, using the template's own diagonal as the dividing edge.
      additions.push(`<xdr:twoCellAnchor editAs="twoCell">${a1}${triangleShape(nextId++,`SF2 Cutting Classes ${ref} lower diagonal half`,x,y,w,fullH,false)}<xdr:clientData/></xdr:twoCellAnchor>`);
    }
  }
  drawing = drawing.replace('</xdr:wsDr>', additions.join('') + '</xdr:wsDr>');
  zip.updateFile('xl/drawings/drawing1.xml', Buffer.from(drawing,'utf8'));
}



function setWorksheetCellStyle(xml, ref, styleIndex) {
  const r = regexEscape(ref);
  const re = new RegExp(`<c\\b([^>]*\\br="${r}"[^>]*)`);
  const m = xml.match(re);
  if (!m) throw new Error(`Official template cell ${ref} was not found.`);
  let attrs = m[1];
  if (/\bs="[^"]*"/.test(attrs)) attrs = attrs.replace(/\bs="[^"]*"/, ` s="${styleIndex}"`);
  else attrs += ` s="${styleIndex}"`;
  return xml.replace(m[0], `<c${attrs}`);
}

function sf2EnsureSignatureCenterStyle(zip, worksheetXml) {
  // Build a generated-copy-only style based on the existing adviser/principal signature-line
  // style. Center-across-selection keeps the official line geometry intact while centering the
  // printed name over AD:AI.
  const refMatch = worksheetXml.match(/<c\b([^>]*\br="AD88"[^>]*)/);
  const baseStyle = refMatch ? Number((refMatch[1].match(/\bs="(\d+)"/) || [])[1]) : NaN;
  if (!Number.isInteger(baseStyle) || baseStyle < 0) throw new Error('The official SF2 signature-line style was not found.');
  const stylesEntry = zip.getEntry('xl/styles.xml');
  if (!stylesEntry) throw new Error('The official SF2 styles table was not found.');
  let styles = stylesEntry.getData().toString('utf8');
  const section = styles.match(/<cellXfs\b([^>]*)>([\s\S]*?)<\/cellXfs>/);
  if (!section) throw new Error('The official SF2 cell-style table is invalid.');
  const xfs = [];
  const xfStart = /<xf\b[^>]*(?:\/>|>)/g;
  let xfMatch;
  while ((xfMatch = xfStart.exec(section[2]))) {
    let full = xfMatch[0];
    if (!/\/>$/.test(full)) {
      const end = section[2].indexOf('</xf>', xfStart.lastIndex);
      if (end < 0) throw new Error('The official SF2 cell-style table contains an incomplete style.');
      full = section[2].slice(xfMatch.index, end + 5);
      xfStart.lastIndex = end + 5;
    }
    xfs.push(full);
  }
  if (!xfs[baseStyle]) throw new Error('The official SF2 signature-line style index is invalid.');
  let xf = xfs[baseStyle];
  const alignment = '<alignment horizontal="centerContinuous" vertical="center"/>';
  if (/<alignment\b[^>]*\/>/.test(xf)) xf = xf.replace(/<alignment\b[^>]*\/>/, alignment);
  else if (/<alignment\b[^>]*>[\s\S]*?<\/alignment>/.test(xf)) xf = xf.replace(/<alignment\b[^>]*>[\s\S]*?<\/alignment>/, alignment);
  else if (/<\/xf>$/.test(xf)) xf = xf.replace(/<\/xf>$/, `${alignment}</xf>`);
  else if (/\/>$/.test(xf)) xf = xf.replace(/\/>$/, `>${alignment}</xf>`);
  else throw new Error('The official SF2 signature-line style could not be cloned.');
  const oldCount = Number((section[1].match(/\bcount="(\d+)"/) || [])[1] || xfs.length);
  if (!Number.isInteger(oldCount) || oldCount < xfs.length) throw new Error('The official SF2 cell-style count is invalid.');
  const newIndex = oldCount;
  let attrs = section[1];
  if (/\bcount="\d+"/.test(attrs)) attrs = attrs.replace(/\bcount="\d+"/, `count="${oldCount + 1}"`);
  else attrs += ` count="${oldCount + 1}"`;
  styles = styles.replace(section[0], `<cellXfs${attrs}>${section[2]}${xf}</cellXfs>`);
  zip.updateFile('xl/styles.xml', Buffer.from(styles, 'utf8'));
  return newIndex;
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


function validateSf2Payload(payload) {
  if (!payload || typeof payload !== 'object' || !payload.meta || typeof payload.meta !== 'object' || !Array.isArray(payload.days) || !Array.isArray(payload.students) || !payload.summary) {
    throw new Error('The SF2 data sent to the official-output engine is incomplete.');
  }
  if (payload.days.length > 25) throw new Error('The official SF2 template supports at most 25 school days in one reporting month.');
  const male = payload.students.filter(s => s && s.sex === 'M');
  const female = payload.students.filter(s => s && s.sex === 'F');
  if (male.length > 21 || female.length > 25 || male.length + female.length !== payload.students.length) {
    throw new Error('This official SF2 page supports at most 21 Male and 25 Female learners.');
  }
  for (const d of payload.days) {
    if (!d || String(d.date || '').length > 20 || String(d.weekday || '').length > 3) throw new Error('SF2 contains an invalid school-day entry.');
  }
  for (const st of payload.students) {
    if (!st || typeof st !== 'object' || String(st.name || '').length > 500 || String(st.remarks || '').length > 2000) throw new Error('SF2 contains an invalid learner record.');
    if (!Array.isArray(st.marks) || st.marks.length !== payload.days.length) throw new Error(`SF2 attendance is incomplete for ${st.name || 'a learner'}.`);
    for (const mark of st.marks) if (!['P','A','L','C'].includes(String(mark || 'P'))) throw new Error('SF2 contains an unsupported attendance code.');
  }
  for (const [key, value] of Object.entries(payload.meta)) {
    if (value !== null && value !== undefined && typeof value !== 'string' && typeof value !== 'number' && !(key === 'sf2Enabled' && typeof value === 'boolean')) throw new Error(`Invalid SF2 metadata field: ${key}.`);
    if (String(value ?? '').length > 1000) throw new Error(`SF2 metadata field is unexpectedly long: ${key}.`);
  }
}

function cleanBrokenDefinedNames(zip) {
  const wbEntry = zip.getEntry('xl/workbook.xml');
  if (!wbEntry) return;
  let xml = wbEntry.getData().toString('utf8');
  xml = xml.replace(/<definedName\b[^>]*>#REF!<\/definedName>/g, '');
  zip.updateFile('xl/workbook.xml', Buffer.from(xml, 'utf8'));
}

function buildOfficialSf2Buffer(payload, ctx) {
  validateSf2Payload(payload);
  const { fs, resolveResource } = ctx;
  const AdmZip = resolveAdmZip();
  const officialTemplate = resolveResource('templates/SF2 official Template.xlsx');
  if (!fs.existsSync(officialTemplate)) throw new Error('The bundled Official SF2 template is missing.');
  const zip = new AdmZip(fs.readFileSync(officialTemplate));
  assertSafeImportedXlsx(zip, 'The bundled Official SF2 template');
  const entry = zip.getEntry('xl/worksheets/sheet1.xml');
  if (!entry) throw new Error('The official SF2 worksheet was not found in the template.');
  let xml = entry.getData().toString('utf8');
  const meta = payload.meta || {};
  const dayCols = ['D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S','T','U','V','W','X','Y','Z','AA','AB'];

  const headerValues = {
    C6: meta.schoolId || '',
    K6: meta.schoolYear || '',
    X6: payload.monthName || payload.monthLabel || '',
    C8: meta.schoolName || '',
    X8: meta.gradeLevel || '',
    AC8: meta.section || '',
    AC64: payload.monthName || payload.monthLabel || '',
    AG64: Number(payload.summary.schoolDays || payload.days.length || 0)
  };
  for (const [ref, value] of Object.entries(headerValues)) xml = setWorksheetCell(xml, ref, value, typeof value === 'number' ? 'number' : 'string');

  // Calendar header: row 11 = date, row 12 = day of week. Row 13 remains intentionally blank.
  dayCols.forEach((col, i) => {
    const d = payload.days[i];
    xml = setWorksheetCell(xml, `${col}11`, d ? Number(d.day || 0) : '', d ? 'number' : 'string');
    xml = setWorksheetCell(xml, `${col}12`, d ? String(d.weekday || '') : '', 'string');
    xml = setWorksheetCell(xml, `${col}13`, '', 'string');
  });

  const maleRows = Array.from({length:21},(_,i)=>14+i);
  const femaleRows = Array.from({length:25},(_,i)=>36+i);
  const allRows = [...maleRows, ...femaleRows];
  for (const row of allRows) {
    xml = setWorksheetCell(xml, `A${row}`, '', 'string');
    xml = setWorksheetCell(xml, `B${row}`, '', 'string');
    for (const col of dayCols) xml = setWorksheetCell(xml, `${col}${row}`, '', 'string');
    xml = setWorksheetCell(xml, `AC${row}`, '', 'string');
    xml = setWorksheetCell(xml, `AD${row}`, '', 'string');
    xml = setWorksheetCell(xml, `AE${row}`, '', 'string');
  }

  const visualMarks = [];
  function writeStudent(row, st, number) {
    xml = setWorksheetCell(xml, `A${row}`, number, 'number');
    xml = setWorksheetCell(xml, `B${row}`, st.name || '', 'string');
    dayCols.forEach((col,i)=>{
      const mark = String((st.marks || [])[i] || 'P').toUpperCase();
      // Attendance markings are drawn over the untouched official cells: edge-to-edge X for
      // Absent, upper-half shade for Late Comer/Tardy, lower-half shade for Cutting Classes.
      xml = setWorksheetCell(xml, `${col}${row}`, '', 'string');
      if (mark !== 'P') visualMarks.push({ref:`${col}${row}`,mark});
    });
    xml = setWorksheetCell(xml, `AC${row}`, Number(st.absent || 0), 'number');
    xml = setWorksheetCell(xml, `AD${row}`, Number(st.tardy || 0), 'number');
    xml = setWorksheetCell(xml, `AE${row}`, st.remarks || '', 'string');
  }
  let seq = 1;
  payload.students.filter(s=>s.sex==='M').forEach((st,i)=>writeStudent(14+i,st,seq++));
  payload.students.filter(s=>s.sex==='F').forEach((st,i)=>writeStudent(36+i,st,seq++));

  function presentCount(sex,dateIndex) {
    return payload.students.filter(st => (sex === 'T' || st.sex === sex) && String(st.marks[dateIndex] || 'P') !== 'A').length;
  }
  dayCols.forEach((col,i)=>{
    if (i < payload.days.length) {
      xml = setWorksheetCell(xml, `${col}35`, presentCount('M',i), 'number');
      xml = setWorksheetCell(xml, `${col}61`, presentCount('F',i), 'number');
      xml = setWorksheetCell(xml, `${col}62`, presentCount('T',i), 'number');
    } else {
      xml = setWorksheetCell(xml, `${col}35`, '', 'string');
      xml = setWorksheetCell(xml, `${col}61`, '', 'string');
      xml = setWorksheetCell(xml, `${col}62`, '', 'string');
    }
  });
  const maleStudents=payload.students.filter(s=>s.sex==='M'), femaleStudents=payload.students.filter(s=>s.sex==='F');
  const sumField=(arr,key)=>arr.reduce((a,s)=>a+Number(s[key]||0),0);
  xml=setWorksheetCell(xml,'AC35',sumField(maleStudents,'absent'),'number');
  xml=setWorksheetCell(xml,'AD35',sumField(maleStudents,'tardy'),'number');
  xml=setWorksheetCell(xml,'AC61',sumField(femaleStudents,'absent'),'number');
  xml=setWorksheetCell(xml,'AD61',sumField(femaleStudents,'tardy'),'number');
  xml=setWorksheetCell(xml,'AC62',sumField(payload.students,'absent'),'number');
  xml=setWorksheetCell(xml,'AD62',sumField(payload.students,'tardy'),'number');

  const sm = payload.summary || {};
  const summaryRows = [
    [66, sm.first], [68, sm.late], [70, sm.reg], [72, sm.pctEnroll], [74, sm.ada],
    [75, sm.pctAttend], [77, sm.consec5], [79, sm.dropout], [81, sm.transferredOut], [83, sm.transferredIn]
  ];
  for (const [row,obj] of summaryRows) {
    const isDecimal = [72,74,75].includes(row);
    const num = value => { const n=Number(value||0); return isDecimal ? Math.round(n*100)/100 : Math.round(n); };
    xml = setWorksheetCell(xml, `AH${row}`, num(obj ? obj.M : 0), 'number');
    xml = setWorksheetCell(xml, `AI${row}`, num(obj ? obj.F : 0), 'number');
    xml = setWorksheetCell(xml, `AJ${row}`, num(obj ? obj.T : 0), 'number');
  }

  // Put printed names on the existing signature lines; the template's labels remain untouched.
  // Center-across-selection is applied only to the generated copy so the bundled official
  // workbook itself remains byte-identical.
  if (payload.adviser || payload.schoolHead) {
    const signatureStyle = sf2EnsureSignatureCenterStyle(zip, xml);
    for (const row of [88,92]) for (const col of ['AD','AE','AF','AG','AH','AI']) xml = setWorksheetCellStyle(xml, `${col}${row}`, signatureStyle);
  }
  if (payload.adviser) xml = setWorksheetCell(xml, 'AD88', payload.adviser, 'string');
  if (payload.schoolHead) xml = setWorksheetCell(xml, 'AD92', payload.schoolHead, 'string');

  // Collapse unused official learner rows only in the generated copy, then add compliant
  // attendance marks on the drawing layer. The bundled official template is not rewritten.
  xml = compactUnusedSf2LearnerRows(xml, payload);
  sf2AppendComplianceMarks(zip, xml, visualMarks);
  zip.updateFile('xl/worksheets/sheet1.xml', Buffer.from(xml, 'utf8'));
  stripWorkbookExternalLinks(zip);
  cleanBrokenDefinedNames(zip);
  return zip.toBuffer();
}

function buildOfficialDocumentBuffer(kind, payload, ctx) {
  if (kind === 'gs') return buildOfficialGsBuffer(payload, ctx);
  if (kind === 'sf2') return buildOfficialSf2Buffer(payload, ctx);
  return buildOfficialEcrBuffer(payload, ctx);
}

function validatePayload(payload) {
  if (!payload || typeof payload !== 'object' || !payload.meta || typeof payload.meta !== 'object' || !payload.categories || typeof payload.categories !== 'object' || !Array.isArray(payload.students)) {
    throw new Error('The Class Record data sent to the official-output engine is incomplete.');
  }
  if (payload.students.length > 100) throw new Error('The official template supports at most 100 learners.');
  const male = payload.students.filter(s => s && s.sex === 'M');
  const female = payload.students.filter(s => s && s.sex === 'F');
  if (male.length > 50 || female.length > 50 || male.length + female.length !== payload.students.length) {
    throw new Error('Every learner must be identified as Male or Female, with at most 50 in each official-template section.');
  }
  for (const [key, value] of Object.entries(payload.meta)) {
    if (value !== null && value !== undefined && typeof value !== 'string' && typeof value !== 'number' && !(key === 'sf2Enabled' && typeof value === 'boolean')) throw new Error(`Invalid metadata field: ${key}.`);
    if (String(value ?? '').length > 1000) throw new Error(`Metadata field is unexpectedly long: ${key}.`);
  }
  if (payload.schoolLogoDataUri && String(payload.schoolLogoDataUri).length > 8 * 1024 * 1024) throw new Error('The school logo data exceeds the safety limit.');
  const ww = payload.categories.WW || {};
  const pt = payload.categories.PT || {};
  const ex = payload.categories.EXAM || {};
  if ((ww.components || []).length !== 5 || (pt.components || []).length !== 3 || (ex.components || []).length !== 3) {
    throw new Error('The official ECR template requires exactly 5 WW, 3 PT and 3 Examination components.');
  }
  const cats = [['WW',ww],['PT',pt],['EXAM',ex]];
  let totalWeight = 0;
  for (const [key,cat] of cats) {
    const weight = Number(cat.weight);
    if (!Number.isFinite(weight) || weight < 0 || weight > 1) throw new Error(`${key} has an invalid category weight.`);
    totalWeight += weight;
    let customTotal = 0;
    let activeCustomItems = 0;
    for (const c of cat.components) {
      const h = Number(c && c.hps);
      if (!Number.isFinite(h) || h < 0 || h > 1000000) throw new Error(`${key} contains an invalid HPS.`);
      if (String(c && c.name || '').length > 200) throw new Error(`${key} contains an unexpectedly long component name.`);
      if (key === 'EXAM') {
        const sw=Number(c && c.subWeight);
        if (!Number.isFinite(sw) || sw < 0 || sw > 100) throw new Error('EXAM contains an invalid item weight.');
        if (h > 0) { customTotal += sw; activeCustomItems++; }
        else if (Math.abs(sw) > 0.001) throw new Error('An inactive EXAM item (HPS 0) must have 0% item weight.');
      }
    }
    if (key === 'EXAM' && activeCustomItems > 0 && Math.abs(customTotal - 100) > 0.001) throw new Error('Active EXAM item weights must total exactly 100%.');
  }
  if (Math.abs(totalWeight - 1) > 0.0001) throw new Error('Category weights must total exactly 100%.');
  for (const st of payload.students) {
    if (!st || typeof st !== 'object' || String(st.name || '').length > 500) throw new Error('A learner record in the official-output payload is invalid.');
    for (const [key,expected] of [['WW',5],['PT',3],['EXAM',3]]) {
      const scores = st[key] && Array.isArray(st[key].scores) ? st[key].scores : [];
      if (scores.length > expected) throw new Error(`${key} contains too many scores for one learner.`);
      const comps = payload.categories[key].components;
      for (let i=0;i<scores.length;i++) {
        const v=scores[i]; if (v === '' || v === null || v === undefined) continue;
        const n=Number(v),h=Number(comps[i] && comps[i].hps),label=String(comps[i] && comps[i].name || `${key}${i+1}`);
        if (!Number.isFinite(n) || n < 0) throw new Error(`${key} contains an invalid learner score.`);
        if (!Number.isFinite(h) || h < 0) throw new Error(`${label} contains an invalid HPS.`);
        if (h === 0) throw new Error(`${st.name || 'A learner'} has a ${label} score, but its HPS is 0.`);
        if (n > h) throw new Error(`${st.name || 'A learner'} has a ${label} score (${n}) above its HPS (${h}).`);
      }
    }
  }
}

function assertSafeImportedXlsx(zip, label = 'Excel workbook') {
  const entries = zip.getEntries();
  if (entries.length > 1000) throw new Error(`${label} contains too many ZIP entries.`);
  let total = 0;
  for (const entry of entries) {
    const size = Number(entry && entry.header && entry.header.size || 0);
    if (!Number.isFinite(size) || size < 0 || size > 32 * 1024 * 1024) throw new Error(`${label} contains an unexpectedly large internal file.`);
    total += size;
    if (total > 128 * 1024 * 1024) throw new Error(`${label} expands beyond the 128 MB safety limit.`);
    const name = String(entry.entryName || '').replace(/\\/g, '/');
    if (!name || name.startsWith('/') || /^[A-Za-z]:/.test(name) || name.split('/').includes('..')) throw new Error(`${label} contains an unsafe internal path.`);
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

  // The signature structure/line is fixed in the clean official template.
  // Setup supplies only the Subject Teacher name/title values.
  xml = setWorksheetCell(xml, 'C119', meta.teacher || '', 'string');
  xml = setWorksheetCell(xml, 'C120', 'Subject Teacher', 'string');

  // Compact the official preview/print copy by hiding only unused learner rows.
  // Hidden rows retain their original cells/formulas/formatting, so the official
  // template itself is not structurally rewritten.
  xml = compactUnusedLearnerRows(xml, payload);

  zip.updateFile('xl/worksheets/sheet1.xml', Buffer.from(xml, 'utf8'));

  // Keep the official template fixed but replace its school-logo image with
  // the global logo selected in Setup, just as the official GS does.
  replacePngMediaFromDataUri(zip, 'xl/media/image1.png', payload.schoolLogoDataUri);

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
  try { $excel.EnableEvents = $false } catch {}
  try { $excel.AutomationSecurity = 3 } catch {}

  if (-not (Test-Path -LiteralPath $xlsx)) { throw ('Generated official workbook was not found: ' + $xlsx) }
  if ((Get-Item -LiteralPath $xlsx).Length -lt 1024) { throw 'Generated official workbook is incomplete.' }
  $openError = $null
  for ($attempt = 1; $attempt -le 3 -and $workbook -eq $null; $attempt++) {
    try { $workbook = $excel.Workbooks.Open($xlsx) }
    catch { $openError = $_.Exception; Start-Sleep -Milliseconds (250 * $attempt) }
  }
  if ($workbook -eq $null) { if ($openError) { throw $openError }; throw 'Microsoft Excel could not open the generated official workbook.' }
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
  try { $excel.EnableEvents = $false } catch {}
  try { $excel.AutomationSecurity = 3 } catch {}
  try { $excel.ScreenUpdating = $false } catch {}
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
      if ($cmd -eq 'renderEcrTemplate') {
        $workbook = $null
        $sheet = $null
        try {
          $template = [string]$req.templatePath
          $xlsx = [string]$req.xlsxPath
          $pdf = [string]$req.pdfPath
          $plan = $req.plan
          if (-not (Test-Path -LiteralPath $template)) { throw ('Official ECR template was not found: ' + $template) }
          if (Test-Path -LiteralPath $xlsx) { Remove-Item -LiteralPath $xlsx -Force -ErrorAction SilentlyContinue }
          if (Test-Path -LiteralPath $pdf) { Remove-Item -LiteralPath $pdf -Force -ErrorAction SilentlyContinue }
          $workbook = $excel.Workbooks.Open($template)
          $sheet = $workbook.Worksheets.Item(1)

          function Set-MergeSafeCell($sheetObj, [string]$address, $value) {
            $r = $sheetObj.Range($address)
            $t = $r
            if ($r.MergeCells) { $t = $r.MergeArea.Cells.Item(1,1) }
            if ($null -eq $value) { $t.ClearContents() }
            else { $t.Value2 = $value }
            if ($t -ne $r) { try { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($t) } catch {} }
            try { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($r) } catch {}
          }
          function Set-RowValues($sheetObj, [string]$address, $values) {
            $vals = @($values)
            $arr = New-Object 'object[,]' 1,$vals.Count
            for ($i=0; $i -lt $vals.Count; $i++) {
              $v = $vals[$i]
              if ($null -eq $v) { $arr[0,$i] = $null }
              elseif ($v -is [System.ValueType]) { $arr[0,$i] = $v }
              else { $arr[0,$i] = [string]$v }
            }
            $rg = $sheetObj.Range($address)
            $rg.Value2 = $arr
            try { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($rg) } catch {}
          }

          foreach ($prop in $plan.headers.PSObject.Properties) { Set-MergeSafeCell $sheet ([string]$prop.Name) $prop.Value }
          foreach ($prop in $plan.hps.PSObject.Properties) { Set-RowValues $sheet ([string]$prop.Name) $prop.Value }
          foreach ($rp in @($plan.rows)) {
            $row = [int]$rp.row
            Set-MergeSafeCell $sheet ('C' + $row) $rp.name
            Set-RowValues $sheet ('F' + $row + ':M' + $row) $rp.ww
            Set-RowValues $sheet ('N' + $row + ':S' + $row) $rp.pt
            Set-RowValues $sheet ('T' + $row + ':AD' + $row) $rp.ex
          }

          $maleCount = [int]$plan.maleCount
          $femaleCount = [int]$plan.femaleCount
          $maleHideStart = 18 + $maleCount
          if ($maleHideStart -le 67) { $sheet.Rows.Item(($maleHideStart.ToString() + ":67")).Hidden = $true }
          $femaleHideStart = 69 + $femaleCount
          if ($femaleHideStart -le 118) { $sheet.Rows.Item(($femaleHideStart.ToString() + ":118")).Hidden = $true }
          $sheet.Rows.Item('68:68').Hidden = $false

          try {
            $links = @($workbook.LinkSources(1))
            foreach ($lnk in $links) { if ($lnk) { $workbook.BreakLink([string]$lnk, 1) } }
          } catch {}
          $workbook.SaveAs($xlsx, 51)
          [void]$sheet.ExportAsFixedFormat(0, $pdf)
          $workbook.Close($false)
          [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($sheet)
          [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($workbook)
          $sheet = $null
          $workbook = $null
          Send-EcrMessage @{ type='response'; id=$id; ok=$true; pdfPath=$pdf; xlsxPath=$xlsx }
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
      if ($cmd -eq 'render') {
        $workbook = $null
        $sheet = $null
        try {
          $xlsx = [string]$req.xlsxPath
          $pdf = [string]$req.pdfPath
          if (Test-Path -LiteralPath $pdf) { Remove-Item -LiteralPath $pdf -Force -ErrorAction SilentlyContinue }
          if (-not (Test-Path -LiteralPath $xlsx)) { throw ('Generated official workbook was not found: ' + $xlsx) }
          $openError = $null
          for ($attempt = 1; $attempt -le 3 -and $workbook -eq $null; $attempt++) {
            try { $workbook = $excel.Workbooks.Open($xlsx) }
            catch { $openError = $_.Exception; Start-Sleep -Milliseconds (200 * $attempt) }
          }
          if ($workbook -eq $null) { if ($openError) { throw $openError }; throw 'Microsoft Excel could not open the generated official workbook.' }
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

  async renderEcrTemplate(templatePath, xlsxPath, pdfPath, plan) {
    return await this.request('renderEcrTemplate', { templatePath, xlsxPath, pdfPath, plan });
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


function makeEcrExcelRenderPlan(payload) {
  const meta = payload.meta || {};
  const ww = payload.categories.WW || {};
  const pt = payload.categories.PT || {};
  const ex = payload.categories.EXAM || {};
  const termNo = termNumber(payload.termKey);
  const termWords = ['FIRST TERM', 'SECOND TERM', 'THIRD TERM'][termNo - 1];
  const headers = {
    B2: `CLASS RECORD - TERM ${termNo}`,
    F5: meta.region || '', R5: meta.division || '', Z5: meta.schoolId || '',
    F7: meta.schoolName || '', Z7: meta.schoolYear || '',
    B10: termWords, J10: meta.gradeLevel || '', Q10: meta.teacher || '',
    AA10: meta.subject || '', J11: meta.section || '',
    B119: 'Prepared by:', C119: meta.teacher || '',
    C120: 'Subject Teacher'
  };
  const hps = {
    'F15:M15': [
      ...ww.components.map(c=>Number(c.hps||0)),
      ww.components.reduce((a,c)=>a+Number(c.hps||0),0), 100, Number(ww.weight||0)
    ],
    'N15:S15': [
      ...pt.components.map(c=>Number(c.hps||0)),
      pt.components.reduce((a,c)=>a+Number(c.hps||0),0), 100, Number(pt.weight||0)
    ],
    'T15:AD15': [
      ...ex.components.map(c=>Number(c.hps||0)),
      ...ex.components.map(c=>Number(c.subWeight||0)),
      100, Number(ex.weight||0), '', '', ''
    ]
  };
  function rowPlan(row, st) {
    return {
      row,
      name: st.name || '',
      ww: [
        ...((st.WW && st.WW.scores) || []),
        st.WW ? st.WW.total : '', st.WW ? st.WW.ps : '', st.WW ? st.WW.ws : ''
      ],
      pt: [
        ...((st.PT && st.PT.scores) || []),
        st.PT ? st.PT.total : '', st.PT ? st.PT.ps : '', st.PT ? st.PT.ws : ''
      ],
      ex: [
        ...((st.EXAM && st.EXAM.scores) || []),
        ...((st.EXAM && st.EXAM.componentPs) || []),
        st.EXAM ? st.EXAM.ps : '', st.EXAM ? st.EXAM.ws : '',
        st.initial, st.term, st.descriptor || ''
      ]
    };
  }
  const male = payload.students.filter(s=>s.sex==='M');
  const female = payload.students.filter(s=>s.sex==='F');
  return {
    headers,
    hps,
    maleCount: male.length,
    femaleCount: female.length,
    rows: [
      ...male.map((st,i)=>rowPlan(18+i,st)),
      ...female.map((st,i)=>rowPlan(69+i,st))
    ]
  };
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


function sf2TemplateFingerprint(ctx) {
  const { fs, resolveResource } = ctx;
  const templatePath = resolveResource('templates/SF2 official Template.xlsx');
  const stat = fs.statSync(templatePath);
  const key = `${templatePath}|${stat.size}|${stat.mtimeMs}`;
  if (sf2TemplateFingerprintCache && sf2TemplateFingerprintCache.key === key) return sf2TemplateFingerprintCache.hash;
  const crypto = require('crypto');
  const hash = crypto.createHash('sha256').update(fs.readFileSync(templatePath)).digest('hex');
  sf2TemplateFingerprintCache = { key, hash };
  return hash;
}

function sf2PreviewSignature(payload, ctx) {
  const crypto = require('crypto');
  return crypto.createHash('sha256')
    .update('sf2-preview-v1.1.4\n')
    .update(sf2TemplateFingerprint(ctx))
    .update('\n')
    .update(stableStringify(payload))
    .digest('hex');
}

function gsPreviewSignature(payload, ctx) {
  const crypto = require('crypto');
  return crypto.createHash('sha256')
    .update('gs-preview-v1.0.20-stability-gate\n')
    .update(gsTemplateFingerprint(ctx))
    .update('\n')
    .update(stableStringify(payload))
    .digest('hex');
}

function previewSignature(payload, ctx) {
  const crypto = require('crypto');
  return crypto.createHash('sha256')
    .update('ecr-preview-v1.0.20-stability-gate\n')
    .update(templateFingerprint(ctx))
    .update('\n')
    .update(stableStringify(payload))
    .digest('hex');
}

function isUsablePreviewFile(fs, filePath) {
  try {
    const st=fs.statSync(filePath);
    if(!st.isFile() || st.size<=500) return false;
    const fd=fs.openSync(filePath,'r');
    try{
      const head=Buffer.alloc(8);const n=fs.readSync(fd,head,0,head.length,0);
      const ext=String(filePath).toLowerCase();
      if(ext.endsWith('.pdf')) return n>=5 && head.subarray(0,5).toString('ascii')==='%PDF-';
      if(ext.endsWith('.xlsx')) return n>=4 && head[0]===0x50 && head[1]===0x4b && (head[2]===0x03||head[2]===0x05||head[2]===0x07) && (head[3]===0x04||head[3]===0x06||head[3]===0x08);
      return true;
    }finally{fs.closeSync(fd);}
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

  const allowedPdfUrl = pathToFileURL(pdfPath).href;
  win.webContents.on('will-navigate', (event, url) => { if (url !== allowedPdfUrl && !url.startsWith(allowedPdfUrl + '#')) event.preventDefault(); });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('did-fail-load', (_event, code, desc) => {
    if (code === -3) return;
    console.error('Official ECR popup preview failed to load:', code, desc);
  });
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => previewWindows.delete(win));
  win.loadURL(allowedPdfUrl);
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

  // v1.0.19 uses the same stable pipeline as the working Grading Sheet:
  // clean formula-free official template -> direct app values -> Excel PDF render.
  // Excel no longer writes cells, evaluates formulas, follows links, or breaks links.
  fs.writeFileSync(xlsxPath, buildOfficialDocumentBuffer('ecr', payload, ctx));
  let renderError = null;
  try {
    if (!excelEngine) excelEngine = new PersistentExcelRenderer(ctx);
    await excelEngine.render(xlsxPath, pdfPath);
  } catch (err) {
    renderError = err;
    try { if (excelEngine) excelEngine.stop(); } catch {}
    excelEngine = null;
    await new Promise(r => setTimeout(r, 350));
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
  const allowedPdfUrl = pathToFileURL(pdfPath).href;
  win.webContents.on('will-navigate', (event, url) => { if (url !== allowedPdfUrl && !url.startsWith(allowedPdfUrl + '#')) event.preventDefault(); });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('did-fail-load', (_event, code, desc) => {
    if (code === -3) return;
    console.error('Official GS popup preview failed to load:', code, desc);
  });
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => previewWindows.delete(win));
  win.loadURL(allowedPdfUrl);
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
    try { if (excelEngine) excelEngine.stop(); } catch {}
    excelEngine = null;
    await new Promise(r => setTimeout(r, 350));
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


function openSf2PdfPopup(pdfPath, xlsxPath, payload, ctx) {
  const { BrowserWindow, Menu, shell, getMainWindow } = ctx;
  if (!BrowserWindow) throw new Error('The in-app preview window service is unavailable.');
  const { pathToFileURL } = require('url');
  const parent = typeof getMainWindow === 'function' ? getMainWindow() : null;
  const className = payload.meta && payload.meta.className ? payload.meta.className : 'SF2';
  const win = new BrowserWindow({
    width:1280,height:900,minWidth:900,minHeight:650,
    parent: parent && !parent.isDestroyed() ? parent : undefined,
    modal:false,title:`Official SF2 Print Preview — ${className} — ${payload.monthLabel || ''}`,
    backgroundColor:'#525659',show:false,autoHideMenuBar:false,
    webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true,plugins:true}
  });
  previewWindows.add(win);
  const doPrint=()=>{if(!win.isDestroyed())win.webContents.print({silent:false,printBackground:true,color:true,margins:{marginType:'default'}});};
  if(Menu){
    win.setMenu(Menu.buildFromTemplate([
      {label:'File',submenu:[
        {label:'Print...',accelerator:'CmdOrCtrl+P',click:doPrint},
        {label:'Open Official SF2 in Excel',click:()=>shell.openPath(xlsxPath)},
        {type:'separator'},
        {label:'Close Preview',accelerator:'Esc',click:()=>{if(!win.isDestroyed())win.close();}}
      ]},
      {label:'View',submenu:[{role:'zoomIn'},{role:'zoomOut'},{role:'resetZoom'},{type:'separator'},{role:'togglefullscreen'}]}
    ]));
  }
  const allowedPdfUrl=pathToFileURL(pdfPath).href;
  win.webContents.on('will-navigate',(event,url)=>{if(url!==allowedPdfUrl&&!url.startsWith(allowedPdfUrl+'#'))event.preventDefault();});
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('did-fail-load',(_event,code,desc)=>{if(code!==-3)console.error('Official SF2 popup preview failed to load:',code,desc);});
  win.once('ready-to-show',()=>win.show());
  win.on('closed',()=>previewWindows.delete(win));
  win.loadURL(allowedPdfUrl);
  return win;
}

async function createOfficialSf2PopupPreview(payload, context) {
  const ctx={...(startupContext||{}),...(context||{})};
  validateSf2Payload(payload);
  if(process.platform!=='win32') return {ok:false,previewUnavailable:true,error:'Official SF2 preview requires Windows and desktop Microsoft Excel.'};
  const {fs,path,dataPaths}=ctx;
  const root=dataPaths().root;
  const previewDir=path.join(root,'Official SF2 Preview Cache');
  fs.mkdirSync(previewDir,{recursive:true});
  const classPart=cleanFileName(payload.meta.className||`${payload.meta.gradeLevel||''} ${payload.meta.section||''}`||'SF2');
  const signature=sf2PreviewSignature(payload,ctx),shortSig=signature.slice(0,20);
  const monthPart=cleanFileName(payload.monthLabel||'Month');
  const base=`${classPart} - ${monthPart} - SF2 - ${shortSig}`;
  const xlsxPath=path.join(previewDir,`${base}.xlsx`),pdfPath=path.join(previewDir,`${base}.pdf`);
  if(isUsablePreviewFile(fs,xlsxPath)&&isUsablePreviewFile(fs,pdfPath)){
    openSf2PdfPopup(pdfPath,xlsxPath,payload,ctx);
    return {ok:true,preview:true,inAppPopup:true,cached:true,signature,xlsxPath,pdfPath};
  }
  fs.writeFileSync(xlsxPath,buildOfficialDocumentBuffer('sf2',payload,ctx));
  let renderError=null;
  try{
    if(!excelEngine)excelEngine=new PersistentExcelRenderer(ctx);
    await excelEngine.render(xlsxPath,pdfPath);
  }catch(err){
    renderError=err;try{if(excelEngine)excelEngine.stop();}catch{}excelEngine=null;
    await new Promise(r=>setTimeout(r,350));
    const fallback=await fallbackOneShotRender(xlsxPath,pdfPath,ctx);
    if(!fallback.ok) return {ok:false,previewUnavailable:true,openedFallback:false,xlsxPath,pdfPath,error:fallback.error||(renderError&&renderError.message)||'Microsoft Excel did not create the official SF2 PDF preview.'};
  }
  if(!isUsablePreviewFile(fs,pdfPath)) return {ok:false,previewUnavailable:true,openedFallback:false,xlsxPath,pdfPath,error:'Microsoft Excel completed without producing a usable official SF2 PDF preview.'};
  openSf2PdfPopup(pdfPath,xlsxPath,payload,ctx);
  try{
    const cutoff=Date.now()-14*24*60*60*1000;
    for(const name of fs.readdirSync(previewDir)){const p=path.join(previewDir,name);if(p===xlsxPath||p===pdfPath)continue;try{const st=fs.statSync(p);if(st.isFile()&&st.mtimeMs<cutoff)fs.unlinkSync(p);}catch{}}
  }catch{}
  return {ok:true,preview:true,inAppPopup:true,cached:false,signature,xlsxPath,pdfPath};
}

async function saveOfficialDocument(kind, payload, context) {
  const ctx = { ...(startupContext || {}), ...(context || {}) };
  if (kind === 'sf2') validateSf2Payload(payload); else validatePayload(payload);
  const { app, dialog, fs, path, getMainWindow } = ctx;
  if (!dialog || typeof dialog.showSaveDialog !== 'function') throw new Error('The Windows Save dialog is unavailable.');
  const classPart = cleanFileName(payload.meta.className || `${payload.meta.gradeLevel || ''} ${payload.meta.section || ''}` || 'Class');
  let defaultName, title;
  if (kind === 'sf2') {
    const monthPart = cleanFileName(payload.monthLabel || payload.monthKey || 'Month');
    defaultName = `${classPart} - ${monthPart} - Official SF2.xlsx`;
    title = 'Save Official SF2';
  } else {
    const termNo = termNumber(payload.termKey);
    const label = kind === 'gs' ? 'Official GS' : 'Official ECR';
    defaultName = `${classPart} - Term ${termNo} - ${label}.xlsx`;
    title = kind === 'gs' ? 'Save Official Grading Sheet' : 'Save Official Class Record';
  }
  const parent = typeof getMainWindow === 'function' ? getMainWindow() : undefined;
  const result = await dialog.showSaveDialog(parent, {
    title,
    defaultPath: path.join(app.getPath('documents'), defaultName),
    filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }]
  });
  if (result.canceled || !result.filePath) return { ok: false, cancelled: true };
  const buffer = buildOfficialDocumentBuffer(kind, payload, ctx);
  fs.writeFileSync(result.filePath, buffer);
  return { ok: true, path: result.filePath, xlsxPath: result.filePath };
}



function xmlDecodeText(value) {
  return String(value ?? '').replace(/&#x([0-9a-fA-F]+);/g,(_m,h)=>String.fromCodePoint(parseInt(h,16)))
    .replace(/&#([0-9]+);/g,(_m,d)=>String.fromCodePoint(parseInt(d,10)))
    .replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&');
}
function columnIndexFromRef(ref){
  const m=String(ref||'').match(/^([A-Z]+)/i);if(!m)return 0;let n=0;for(const ch of m[1].toUpperCase())n=n*26+(ch.charCodeAt(0)-64);return n-1;
}
function parseCsvMatrix(text){
  const rows=[];let row=[],cell='',q=false,cells=0;const src=String(text||'').replace(/^\uFEFF/,'');
  const pushCell=(v)=>{if(++cells>500000)throw new Error('Summary table contains too many cells.');if(row.length>=500)throw new Error('Summary table contains more than 500 columns.');row.push(v);};
  const pushRow=()=>{if(rows.length>=5000)throw new Error('Summary table contains more than 5,000 rows.');rows.push(row);row=[];};
  for(let i=0;i<src.length;i++){const ch=src[i];if(q){if(ch==='"'&&src[i+1]==='"'){cell+='"';i++;}else if(ch==='"')q=false;else cell+=ch;}else{if(ch==='"')q=true;else if(ch===','){pushCell(cell);cell='';}else if(ch==='\n'){pushCell(cell.replace(/\r$/,''));pushRow();cell='';}else cell+=ch;}}
  pushCell(cell.replace(/\r$/,''));if(row.some(v=>v!==''))pushRow();return rows;
}
function parseXlsxMatrix(filePath, ctx){
  const AdmZip=resolveAdmZip();const zip=new AdmZip(ctx.fs.readFileSync(filePath));assertSafeImportedXlsx(zip,'The summary workbook');
  const ss=[];const se=zip.getEntry('xl/sharedStrings.xml');if(se){const sx=se.getData().toString('utf8');let sm;const sir=/<si\b[^>]*>([\s\S]*?)<\/si>/g;while((sm=sir.exec(sx))){let t='',tm;const tr=/<t\b[^>]*>([\s\S]*?)<\/t>/g;while((tm=tr.exec(sm[1])))t+=xmlDecodeText(tm[1]);ss.push(t);}}
  let sheetEntry=zip.getEntry('xl/worksheets/sheet1.xml');if(!sheetEntry)throw new Error('The first worksheet could not be read.');const xml=sheetEntry.getData().toString('utf8');
  const rows=[];let rm;const rr=/<row\b[^>]*\br="(\d+)"[^>]*>([\s\S]*?)<\/row>/g;
  while((rm=rr.exec(xml))){if(rows.length>=5000)throw new Error('Summary workbook contains more than 5,000 rows.');const out=[];let cm;const cr=/<c\b([^>]*\br="([A-Z]+\d+)"[^>]*)>([\s\S]*?)<\/c>|<c\b([^>]*\br="([A-Z]+\d+)"[^>]*)\/>/g;while((cm=cr.exec(rm[2]))){const attrs=cm[1]||cm[4]||'',ref=cm[2]||cm[5],body=cm[3]||'',i=columnIndexFromRef(ref),type=((attrs.match(/\bt="([^"]+)"/)||[])[1]||'').toLowerCase();if(i<0||i>=500)throw new Error('Summary workbook contains a cell beyond the 500-column safety limit.');let v='';if(type==='inlinestr'){let tm;const tr=/<t\b[^>]*>([\s\S]*?)<\/t>/g;while((tm=tr.exec(body)))v+=xmlDecodeText(tm[1]);}else{const vm=body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/);if(vm){const raw=xmlDecodeText(vm[1]);if(type==='s'){const k=Number(raw);v=Number.isInteger(k)&&k>=0&&k<ss.length?ss[k]:'';}else{const n=Number(raw);v=raw.trim()!==''&&Number.isFinite(n)?n:raw;}}}out[i]=v;}rows.push(out);}
  return rows;
}
async function importSummaryFile(context){
  const ctx={...(startupContext||{}),...(context||{})};const parent=typeof ctx.getMainWindow==='function'?ctx.getMainWindow():undefined;
  const r=await ctx.dialog.showOpenDialog(parent,{title:'Import Summary of Grades',properties:['openFile'],filters:[{name:'Summary Table',extensions:['xlsx','csv']}]});
  if(r.canceled||!r.filePaths||!r.filePaths[0])return{ok:false,cancelled:true};const filePath=r.filePaths[0];const ext=ctx.path.extname(filePath).toLowerCase();
  const st=ctx.fs.statSync(filePath);if(!st.isFile()||st.size>25*1024*1024)throw new Error('Summary import file exceeds the 25 MB safety limit.');
  let rows;if(ext==='.csv')rows=parseCsvMatrix(ctx.fs.readFileSync(filePath,'utf8'));else rows=parseXlsxMatrix(filePath,ctx);
  rows=rows.filter(row=>(row||[]).some(v=>String(v??'').trim()!==''));
  return{ok:true,fileName:ctx.path.basename(filePath),rows};
}
function openSf9HtmlPreview(payload, context){
  const ctx={...(startupContext||{}),...(context||{})};if(!ctx.BrowserWindow)return{ok:false,error:'Preview window service is unavailable.'};
  const parent=typeof ctx.getMainWindow==='function'?ctx.getMainWindow():null;const win=new ctx.BrowserWindow({width:1200,height:880,minWidth:800,minHeight:600,parent:parent&&!parent.isDestroyed()?parent:undefined,modal:false,title:`SF9 Preview — ${String(payload&&payload.name||'Learner')}`,backgroundColor:'#525659',show:false,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true}});
  previewWindows.add(win);if(ctx.Menu){const doPrint=()=>{if(!win.isDestroyed())win.webContents.print({silent:false,printBackground:true,color:true,margins:{marginType:'default'}});};win.setMenu(ctx.Menu.buildFromTemplate([{label:'File',submenu:[{label:'Print...',accelerator:'CmdOrCtrl+P',click:doPrint},{type:'separator'},{label:'Close Preview',accelerator:'Esc',click:()=>{if(!win.isDestroyed())win.close();}}]},{label:'View',submenu:[{role:'zoomIn'},{role:'zoomOut'},{role:'resetZoom'},{type:'separator'},{role:'togglefullscreen'}]}]));}
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('will-navigate',(event,url)=>{if(!String(url).startsWith('data:text/html'))event.preventDefault();});
  const rawHtml=String(payload&&payload.html||'');
  const csp=`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'">`;
  const safeHtml=/<head[\s>]/i.test(rawHtml)?rawHtml.replace(/<head([^>]*)>/i,`<head$1>${csp}`):`<!doctype html><html><head>${csp}</head><body>${rawHtml}</body></html>`;
  win.once('ready-to-show',()=>win.show());win.on('closed',()=>previewWindows.delete(win));win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(safeHtml));return{ok:true};
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
    if (action === 'sf2:official-pdf-preview' || action === 'sf2:official-popup-preview') {
      return createOfficialSf2PopupPreview(payload, context);
    }
    if (action === 'sf2:official-save') return saveOfficialDocument('sf2', payload, context);
    if (action === 'summary:import-file') return importSummaryFile(context);
    if (action === 'sf9:preview-html') return openSf9HtmlPreview(payload, context);
    if (action === 'window:fullscreen-state') {
      const w = startupContext && typeof startupContext.getMainWindow === 'function' ? startupContext.getMainWindow() : null;
      return { ok: true, fullscreen: !!(w && !w.isDestroyed() && w.isFullScreen()) };
    }
    if (action === 'window:exit-fullscreen') {
      const w = startupContext && typeof startupContext.getMainWindow === 'function' ? startupContext.getMainWindow() : null;
      if (w && !w.isDestroyed()) { w.setFullScreen(false); if (w.isMaximized()) w.unmaximize(); w.show(); w.focus(); }
      return { ok: true };
    }
    if (action === 'ecr:preview-engine-status' || action === 'official:preview-engine-status') {
      return { ok: true, warm: !!(excelEngine && excelEngine.ready) };
    }
    return { ok: false, unsupported: true, error: `Runtime action is not available in this build: ${action}` };
  }
};

