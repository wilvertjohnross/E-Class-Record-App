'use strict';

// v1.1.11 — bounded-flexibility importers for teacher-supplied ECR/SF1 files.
// Philosophy: be flexible about layout, sheet names, blank rows/columns and common
// label variants; remain strict about data meaning. Ambiguous structures are
// rejected or warned rather than silently guessed.

const path = require('path');

const OLE_FREESECT = 0xFFFFFFFF;
const OLE_ENDOFCHAIN = 0xFFFFFFFE;

function text(v) {
  return String(v === null || v === undefined ? '' : v).replace(/\r/g, '').normalize('NFC').trim();
}
function semantic(v) {
  return text(v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ').trim();
}
function isExcelError(v) { return /^#(?:NAME\?|REF!|N\/A|VALUE!|DIV\/0!|NUM!|NULL!)/i.test(text(v)); }
function numberOrBlank(v) {
  if (v === '' || v === null || v === undefined) return '';
  const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : '';
}
function normalizeLrn(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return String(Math.trunc(v));
  return text(v).replace(/\.0+$/, '').replace(/\D/g, '');
}
function normalizeAge(v) { const m = text(v).match(/\b(\d{1,2})\b/); return m ? m[1] : ''; }
function normalizeSex(v) {
  const s = semantic(v);
  if (s === 'f' || s.startsWith('female') || s === 'girl') return 'F';
  if (s === 'm' || s.startsWith('male') || s === 'boy') return 'M';
  return '';
}
function excelSerialToIso(v) {
  const n = numberOrBlank(v);
  if (n === '' || n < 1 || n > 80000) return text(v);
  const ms = Date.UTC(1899, 11, 30) + Math.round(n) * 86400000;
  const d = new Date(ms);
  if (!Number.isFinite(d.getTime())) return text(v);
  return d.toISOString().slice(0, 10);
}
function xmlDecode(value) {
  return String(value ?? '')
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#([0-9]+);/g, (_m, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}
function colIndex(ref) {
  const m = String(ref || '').match(/^([A-Z]+)/i); if (!m) return -1;
  let n = 0; for (const ch of m[1].toUpperCase()) n = n * 26 + ch.charCodeAt(0) - 64;
  return n - 1;
}
function rowIndex(ref) { const m = String(ref || '').match(/(\d+)$/); return m ? Number(m[1]) - 1 : -1; }

class MatrixSheet {
  constructor(name) { this.name = text(name) || 'Sheet'; this.cells = new Map(); this.maxRow = -1; this.maxCol = -1; }
  key(r, c) { return `${r}:${c}`; }
  set(r, c, v) {
    if (!Number.isInteger(r) || !Number.isInteger(c) || r < 0 || c < 0 || r > 4999 || c > 499) return;
    this.cells.set(this.key(r, c), v);
    if (r > this.maxRow) this.maxRow = r; if (c > this.maxCol) this.maxCol = c;
  }
  get(r, c) { return this.cells.has(this.key(r, c)) ? this.cells.get(this.key(r, c)) : ''; }
  rowText(r, c0 = 0, c1 = Math.min(this.maxCol, 120)) {
    const out = []; for (let c = c0; c <= c1; c++) { const v = text(this.get(r, c)); if (v) out.push(v); }
    return out.join(' ');
  }
}

function resolveAdmZip() {
  try { if (require.main && typeof require.main.require === 'function') return require.main.require('adm-zip'); } catch {}
  try { return require('adm-zip'); } catch {}
  throw new Error('The workbook ZIP engine is unavailable in this installation.');
}
function assertSafeXlsx(zip, label = 'Excel workbook') {
  const entries = zip.getEntries();
  if (entries.length > 1000) throw new Error(`${label} contains too many ZIP entries.`);
  let total = 0;
  for (const entry of entries) {
    const size = Number(entry && entry.header && entry.header.size || 0);
    if (!Number.isFinite(size) || size < 0 || size > 32 * 1024 * 1024) throw new Error(`${label} contains an unexpectedly large internal file.`);
    total += size; if (total > 128 * 1024 * 1024) throw new Error(`${label} expands beyond the 128 MB safety limit.`);
    const name = String(entry.entryName || '').replace(/\\/g, '/');
    if (!name || name.startsWith('/') || /^[A-Za-z]:/.test(name) || name.split('/').includes('..')) throw new Error(`${label} contains an unsafe internal path.`);
  }
}
function parseSharedStringsXml(xml) {
  const out = []; let sm; const sir = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  while ((sm = sir.exec(xml))) {
    let s = '', tm; const tr = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
    while ((tm = tr.exec(sm[1]))) s += xmlDecode(tm[1]);
    out.push(s.normalize('NFC'));
  }
  return out;
}
function parseXlsxSheetXml(name, xml, sharedStrings) {
  const sheet = new MatrixSheet(name); let cm;
  const re = /<c\b([^>]*\br="([A-Z]+\d+)"[^>]*)>([\s\S]*?)<\/c>|<c\b([^>]*\br="([A-Z]+\d+)"[^>]*)\/>/g;
  while ((cm = re.exec(xml))) {
    const attrs = cm[1] || cm[4] || '', ref = cm[2] || cm[5], body = cm[3] || '';
    const r = rowIndex(ref), c = colIndex(ref); if (r < 0 || c < 0) continue;
    const type = ((attrs.match(/\bt="([^"]+)"/) || [])[1] || '').toLowerCase();
    let value = '';
    if (type === 'inlinestr') {
      let tm; const tr = /<t\b[^>]*>([\s\S]*?)<\/t>/g; while ((tm = tr.exec(body))) value += xmlDecode(tm[1]);
    } else {
      const vm = body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/); const raw = vm ? xmlDecode(vm[1]) : '';
      if (type === 's') value = sharedStrings[Number(raw)] ?? '';
      else if (type === 'b') value = raw === '1';
      else if (type === 'str' || type === 'e') value = raw;
      else if (raw !== '' && /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[Ee][-+]?\d+)?$/.test(raw.trim())) value = Number(raw);
      else value = raw;
    }
    sheet.set(r, c, typeof value === 'string' ? value.normalize('NFC') : value);
  }
  return sheet;
}
function parseXlsxWorkbook(filePath, fs) {
  const AdmZip = resolveAdmZip(); const zip = new AdmZip(fs.readFileSync(filePath)); assertSafeXlsx(zip, 'The imported workbook');
  const sharedEntry = zip.getEntry('xl/sharedStrings.xml');
  const ss = sharedEntry ? parseSharedStringsXml(sharedEntry.getData().toString('utf8')) : [];
  const workbookEntry = zip.getEntry('xl/workbook.xml');
  const relsEntry = zip.getEntry('xl/_rels/workbook.xml.rels');
  const sheets = [];
  if (workbookEntry) {
    const wbxml = workbookEntry.getData().toString('utf8');
    const relMap = new Map();
    if (relsEntry) {
      const relxml = relsEntry.getData().toString('utf8'); let rm;
      const rr = /<Relationship\b([^>]*)\/?\s*>/g;
      while ((rm = rr.exec(relxml))) {
        const a = rm[1], id = (a.match(/\bId="([^"]+)"/) || [])[1], target = (a.match(/\bTarget="([^"]+)"/) || [])[1];
        if (id && target) relMap.set(id, target.replace(/^\/?xl\//, ''));
      }
    }
    let sm; const sr = /<sheet\b([^>]*)\/?\s*>/g;
    while ((sm = sr.exec(wbxml))) {
      const a = sm[1]; const name = xmlDecode((a.match(/\bname="([^"]*)"/) || [])[1] || 'Sheet');
      const rid = (a.match(/\br:id="([^"]+)"/) || [])[1]; let target = rid ? relMap.get(rid) : null;
      if (target) target = `xl/${target.replace(/^\//, '')}`;
      if (!target) continue;
      const entry = zip.getEntry(target); if (!entry) continue;
      sheets.push(parseXlsxSheetXml(name, entry.getData().toString('utf8'), ss));
    }
  }
  if (!sheets.length) {
    const entries = zip.getEntries().filter(e => /^xl\/worksheets\/sheet\d+\.xml$/i.test(e.entryName)).sort((a,b)=>a.entryName.localeCompare(b.entryName,undefined,{numeric:true}));
    entries.forEach((entry, i) => sheets.push(parseXlsxSheetXml(`Sheet${i+1}`, entry.getData().toString('utf8'), ss)));
  }
  if (!sheets.length) throw new Error('No readable worksheet was found in the workbook.');
  return sheets;
}

// Minimal, dependency-free BIFF8 reader for legacy SF1 .xls files. This is
// based on the app's existing proven SF1 parser but exposes every worksheet as
// a sparse matrix so semantic detection can tolerate layout variations.
function u16(buf, off) { return buf.readUInt16LE(off); }
function u32(buf, off) { return buf.readUInt32LE(off); }
function readOleWorkbookStream(filePath, fs) {
  const buf = fs.readFileSync(filePath); const magic = Buffer.from([0xD0,0xCF,0x11,0xE0,0xA1,0xB1,0x1A,0xE1]);
  if (buf.length < 512 || !buf.subarray(0,8).equals(magic)) throw new Error('The selected .xls file is not a supported legacy Excel workbook.');
  const sectorSize = 1 << u16(buf,30), miniSectorSize = 1 << u16(buf,32), numFat = u32(buf,44), firstDir = u32(buf,48), cutoff = u32(buf,56), firstMiniFat = u32(buf,60), numMiniFat = u32(buf,64), firstDifat = u32(buf,68), numDifat = u32(buf,72);
  function sector(sid){ if(sid>=0xFFFFFFF0)throw new Error('Invalid OLE sector reference.');const st=512+sid*sectorSize,en=st+sectorSize;if(st<512||en>buf.length)throw new Error('Invalid OLE sector chain.');return buf.subarray(st,en); }
  const difat=[]; for(let i=0;i<109;i++){const sid=u32(buf,76+i*4);if(sid!==OLE_FREESECT)difat.push(sid);} let ds=firstDifat; const dps=sectorSize/4-1;
  for(let n=0;n<numDifat&&ds!==OLE_ENDOFCHAIN&&ds!==OLE_FREESECT;n++){const sec=sector(ds);for(let i=0;i<dps;i++){const sid=u32(sec,i*4);if(sid!==OLE_FREESECT)difat.push(sid);}ds=u32(sec,dps*4);}
  const fat=[]; for(const sid of difat.slice(0,numFat).filter(x=>x<0xFFFFFFF0)){const sec=sector(sid);for(let o=0;o<sectorSize;o+=4)fat.push(u32(sec,o));}
  if(!fat.length)throw new Error('The .xls workbook FAT could not be read.');
  function chain(start,table=fat,reader=sector){if(start===OLE_ENDOFCHAIN||start===OLE_FREESECT)return Buffer.alloc(0);const chunks=[],seen=new Set();let sid=start;while(sid!==OLE_ENDOFCHAIN&&sid!==OLE_FREESECT&&sid<0xFFFFFFF0){if(seen.has(sid))throw new Error('Cyclic OLE sector chain.');seen.add(sid);if(sid>=table.length)throw new Error('Out-of-range OLE sector reference.');chunks.push(reader(sid));sid=table[sid];}return Buffer.concat(chunks);}
  const dir=chain(firstDir), entries=[]; for(let o=0;o+128<=dir.length;o+=128){const e=dir.subarray(o,o+128),nl=u16(e,64),name=nl>=2?e.subarray(0,Math.min(64,nl-2)).toString('utf16le'):'',type=e[66],start=u32(e,116),lo=u32(e,120),hi=u32(e,124),size=hi?hi*0x100000000+lo:lo;entries.push({name,type,start,size});}
  const root=entries.find(e=>e.type===5),book=entries.find(e=>e.type===2&&/^(Workbook|Book)$/i.test(e.name));if(!book)throw new Error('Excel Workbook stream was not found in this .xls file.');
  if(book.size>=cutoff)return chain(book.start).subarray(0,book.size);
  if(!root||firstMiniFat===OLE_ENDOFCHAIN||!numMiniFat)throw new Error('The small Workbook stream could not be read.');
  const mfb=chain(firstMiniFat).subarray(0,numMiniFat*sectorSize),mf=[];for(let o=0;o+4<=mfb.length;o+=4)mf.push(u32(mfb,o));const mini=chain(root.start).subarray(0,root.size);
  function miniSec(sid){const st=sid*miniSectorSize,en=st+miniSectorSize;if(st<0||en>mini.length)throw new Error('Invalid mini-sector reference.');return mini.subarray(st,en);}
  return chain(book.start,mf,miniSec).subarray(0,book.size);
}
function parseBiffRecords(stream){const out=[];let off=0;while(off+4<=stream.length){const id=u16(stream,off),len=u16(stream,off+2),end=off+4+len;if(end>stream.length)break;out.push({off,id,data:stream.subarray(off+4,end)});off=end;}return out;}
class SegmentReader{constructor(segments){this.segments=segments;this.si=0;this.pos=0;}current(){return this.segments[this.si]||Buffer.alloc(0);}advance(){this.si++;this.pos=0;if(this.si>=this.segments.length)throw new Error('Unexpected end of Excel shared-string table.');}byte(){while(this.pos>=this.current().length)this.advance();return this.current()[this.pos++];}bytes(n){const chunks=[];let rem=n;while(rem>0){if(this.pos>=this.current().length)this.advance();const cur=this.current(),take=Math.min(rem,cur.length-this.pos);chunks.push(cur.subarray(this.pos,this.pos+take));this.pos+=take;rem-=take;}return Buffer.concat(chunks,n);}u16(){return this.bytes(2).readUInt16LE(0);}u32(){return this.bytes(4).readUInt32LE(0);}chars(count,highByte){let rem=count,high=!!highByte,out='';while(rem>0){const cur=this.current(),bpc=high?2:1,fit=Math.floor((cur.length-this.pos)/bpc);if(fit<=0){this.advance();high=(this.byte()&1)!==0;continue;}const take=Math.min(rem,fit),raw=cur.subarray(this.pos,this.pos+take*bpc);out+=raw.toString(high?'utf16le':'latin1');this.pos+=take*bpc;rem-=take;if(rem>0&&this.pos>=cur.length){this.advance();high=(this.byte()&1)!==0;}}return out;}}
function parseBiffSst(records){const idx=records.findIndex(r=>r.id===0x00FC);if(idx<0)return[];const sst=records[idx].data;if(sst.length<8)return[];const unique=u32(sst,4),segments=[sst.subarray(8)];for(let i=idx+1;i<records.length&&records[i].id===0x003C;i++)segments.push(records[i].data);const rd=new SegmentReader(segments),out=[];for(let i=0;i<unique;i++){const cch=rd.u16(),flags=rd.byte(),rich=(flags&8)?rd.u16():0,ext=(flags&4)?rd.u32():0;out.push(rd.chars(cch,flags&1).normalize('NFC'));if(rich)rd.bytes(rich*4);if(ext)rd.bytes(ext);}return out;}
function decodeRk(rk){const m=(rk&1)!==0,isInt=(rk&2)!==0;let v;if(isInt)v=(rk>>2);else{const b=Buffer.alloc(8);b.writeUInt32LE(0,0);b.writeUInt32LE(rk&0xFFFFFFFC,4);v=b.readDoubleLE(0);}return m?v/100:v;}
function parseBiffUnicodeString(buf, offset){if(offset+3>buf.length)return'';const cch=u16(buf,offset),flags=buf[offset+2],high=(flags&1)!==0,start=offset+3,need=cch*(high?2:1);if(start+need>buf.length)return'';return buf.subarray(start,start+need).toString(high?'utf16le':'latin1').normalize('NFC');}
function parseBiffSheets(filePath, fs){const stream=readOleWorkbookStream(filePath,fs),records=parseBiffRecords(stream),bof=records[0];if(!bof||bof.id!==0x0809||bof.data.length<2||u16(bof.data,0)<0x0600)throw new Error('The selected .xls file is not a supported Excel 97-2004 workbook.');const sst=parseBiffSst(records),bounds=[];for(const rec of records){if(rec.id!==0x0085||rec.data.length<8)continue;const offset=u32(rec.data,0),cch=rec.data[6],flags=rec.data[7],raw=rec.data.subarray(8,8+cch*((flags&1)?2:1)),name=raw.toString((flags&1)?'utf16le':'latin1').normalize('NFC');bounds.push({offset,name});}bounds.sort((a,b)=>a.offset-b.offset);if(!bounds.length)throw new Error('No worksheet was found in the .xls workbook.');const sheets=[];for(let bi=0;bi<bounds.length;bi++){const start=bounds[bi].offset,end=bi+1<bounds.length?bounds[bi+1].offset:stream.length,sheet=new MatrixSheet(bounds[bi].name);let pendingStringCell=null;for(const rec of records){if(rec.off<start||rec.off>=end)continue;const p=rec.data;if(rec.id===0x00FD&&p.length>=10){sheet.set(u16(p,0),u16(p,2),sst[u32(p,6)]??'');}else if(rec.id===0x027E&&p.length>=10){sheet.set(u16(p,0),u16(p,2),decodeRk(u32(p,6)));}else if(rec.id===0x0203&&p.length>=14){sheet.set(u16(p,0),u16(p,2),p.readDoubleLE(6));}else if(rec.id===0x00BD&&p.length>=12){const row=u16(p,0),fc=u16(p,2),lc=u16(p,p.length-2);let pos=4;for(let c=fc;c<=lc&&pos+6<=p.length-2;c++,pos+=6)sheet.set(row,c,decodeRk(u32(p,pos+2)));}else if(rec.id===0x0204&&p.length>=8){const row=u16(p,0),col=u16(p,2);sheet.set(row,col,parseBiffUnicodeString(p,6));}else if(rec.id===0x0006&&p.length>=14){const row=u16(p,0),col=u16(p,2),res=p.subarray(6,14);if(res[6]===0xFF&&res[7]===0xFF){pendingStringCell={row,col};}else{sheet.set(row,col,res.readDoubleLE(0));pendingStringCell=null;}}else if(rec.id===0x0207&&pendingStringCell){const s=parseBiffUnicodeString(p,0);sheet.set(pendingStringCell.row,pendingStringCell.col,s);pendingStringCell=null;}}
    sheets.push(sheet);}return sheets;}
function loadWorkbook(filePath, ctx){const ext=path.extname(filePath).toLowerCase();if(ext==='.xlsx')return parseXlsxWorkbook(filePath,ctx.fs);if(ext==='.xls')return parseBiffSheets(filePath,ctx.fs);throw new Error('Please select an Excel .xls or .xlsx workbook.');}

function cellSemantic(sheet,r,c){return semantic(sheet.get(r,c));}
function labelWindow(sheet,r,c){return semantic([sheet.get(r,c),sheet.get(r+1,c)].map(text).filter(Boolean).join(' '));}
function isLrnHeader(t){return t==='lrn'||t.startsWith('lrn ')||t.includes('learner reference number')||t.includes('learner reference no');}
function isNameHeader(t){return t==='name'||t.includes('name of learner')||t.includes('learner name')||t.includes('learners name')||t.includes('full name');}
function isLastNameHeader(t){return t.includes('last name')||t==='surname'||t.includes('family name');}
function isFirstNameHeader(t){return t.includes('first name')||t.includes('given name');}
function isMiddleNameHeader(t){return t.includes('middle name');}
function isExtensionHeader(t){return t.includes('name extension')||t==='extension'||t==='suffix';}
function isSexHeader(t){return t==='sex'||t==='m f'||t==='gender'||t.includes('sex gender');}
function isBirthHeader(t){return t.includes('birth date')||t.includes('date of birth')||t==='birthday';}
function isAgeHeader(t){return t==='age'||t.startsWith('age as of')||t.includes('age as of');}

function detectSf1Header(sheet){let best=null;const maxR=Math.min(Math.max(sheet.maxRow,0),70),maxC=Math.min(Math.max(sheet.maxCol,0),140);for(let r=0;r<=maxR;r++){const cols={lrn:-1,name:-1,last:-1,first:-1,middle:-1,ext:-1,sex:-1,birth:-1,age:-1};for(let c=0;c<=maxC;c++){const t=labelWindow(sheet,r,c);if(!t)continue;if(cols.lrn<0&&isLrnHeader(t))cols.lrn=c;if(cols.name<0&&isNameHeader(t)&&!isLastNameHeader(t)&&!isFirstNameHeader(t)&&!isMiddleNameHeader(t))cols.name=c;if(cols.last<0&&isLastNameHeader(t))cols.last=c;if(cols.first<0&&isFirstNameHeader(t))cols.first=c;if(cols.middle<0&&isMiddleNameHeader(t))cols.middle=c;if(cols.ext<0&&isExtensionHeader(t))cols.ext=c;if(cols.sex<0&&isSexHeader(t))cols.sex=c;if(cols.birth<0&&isBirthHeader(t))cols.birth=c;if(cols.age<0&&isAgeHeader(t))cols.age=c;}
    const hasName=cols.name>=0||(cols.last>=0&&cols.first>=0);if(cols.lrn<0||!hasName)continue;let score=80;if(cols.sex>=0)score+=8;if(cols.birth>=0)score+=5;if(cols.age>=0)score+=5;if(cols.last>=0&&cols.first>=0)score+=2;const cand={row:r,cols,score};if(!best||cand.score>best.score)best=cand;}return best;}
function rowSexMarker(sheet,r,maxC){const s=semantic(sheet.rowText(r,0,maxC));if(/^male$/.test(s)||/^male learners?$/.test(s)||s==='boys')return'M';if(/^female$/.test(s)||/^female learners?$/.test(s)||s==='girls')return'F';// Merged templates often carry only one marker plus row-number blanks.
  for(let c=0;c<=maxC;c++){const t=semantic(sheet.get(r,c));if(t==='male')return'M';if(t==='female')return'F';}return'';}
function composeName(sheet,r,cols){if(cols.name>=0)return text(sheet.get(r,cols.name));const last=text(sheet.get(r,cols.last)),first=text(sheet.get(r,cols.first)),middle=cols.middle>=0?text(sheet.get(r,cols.middle)):'',ext=cols.ext>=0?text(sheet.get(r,cols.ext)):'';if(!last&&!first)return'';const given=[first,ext,middle].filter(Boolean).join(' ');return last&&given?`${last}, ${given}`:(last||given);}
function findMetaValue(sheet,synonyms,maxRows=35,maxCols=140){const wanted=synonyms.map(semantic);for(let r=0;r<=Math.min(sheet.maxRow,maxRows);r++)for(let c=0;c<=Math.min(sheet.maxCol,maxCols);c++){const raw=text(sheet.get(r,c)),t=semantic(raw);if(!t)continue;let matched=false;for(const w of wanted){if(t===w||t.startsWith(`${w} `)){matched=true;const colon=raw.indexOf(':');if(colon>=0&&text(raw.slice(colon+1)))return text(raw.slice(colon+1));break;}}if(!matched)continue;for(let d=1;d<=12&&c+d<=Math.min(sheet.maxCol,maxCols);d++){const v=text(sheet.get(r,c+d));if(v&&!wanted.includes(semantic(v))&&!/^(school|grade|section|region|division|teacher|subject)\b/i.test(v))return v;}for(let dr=1;dr<=2&&r+dr<=sheet.maxRow;dr++){for(let dc=0;dc<=3&&c+dc<=sheet.maxCol;dc++){const v=text(sheet.get(r+dr,c+dc));if(v)return v;}}}return'';}
function sf1Meta(sheet){let region=findMetaValue(sheet,['Region']);if(!region){for(let r=0;r<=Math.min(sheet.maxRow,15)&&!region;r++)for(let c=0;c<=Math.min(sheet.maxCol,80);c++){const v=text(sheet.get(r,c));if(/^Region\s+[IVX0-9-]+$/i.test(v)){region=v;break;}}}return{schoolId:findMetaValue(sheet,['School ID','School Id No','School Number']),region,division:findMetaValue(sheet,['Division','Schools Division']),schoolName:findMetaValue(sheet,['School Name','Name of School']),schoolYear:findMetaValue(sheet,['School Year','SY','S Y']),gradeLevel:findMetaValue(sheet,['Grade Level','Grade','Year Level']),section:findMetaValue(sheet,['Section'])};}
function parseSf1Sheet(sheet){const header=detectSf1Header(sheet);if(!header)return null;const {cols}=header,warnings=[],learners=[],seen=new Set();let currentSex='',blankRun=0,sexEvidence=cols.sex>=0;const maxC=Math.min(Math.max(sheet.maxCol,0),140);for(let r=header.row+1;r<=Math.min(sheet.maxRow,header.row+500);r++){const rowHeaderText=semantic(sheet.rowText(r,0,maxC));if((rowHeaderText.includes('lrn')||rowHeaderText.includes('learner reference'))&&(rowHeaderText.includes('name')||rowHeaderText.includes('surname')))continue;const marker=rowSexMarker(sheet,r,maxC);if(marker){currentSex=marker;sexEvidence=true;continue;}const name=composeName(sheet,r,cols),rawLrn=sheet.get(r,cols.lrn),lrn=normalizeLrn(rawLrn);if(!name&&!lrn){if(learners.length&&++blankRun>50)break;continue;}blankRun=0;if(isExcelError(name)){warnings.push(`Row ${r+1} contains an unresolved Excel value instead of a learner name and was skipped.`);continue;}if(!name){warnings.push(`Row ${r+1} has an LRN but no learner name and was skipped.`);continue;}if(!/^\d{12}$/.test(lrn)){warnings.push(`Row ${r+1} (${name}) does not contain a valid 12-digit LRN and was skipped.`);continue;}if(seen.has(lrn)){warnings.push(`Duplicate LRN ${lrn} was found; the later duplicate at row ${r+1} was skipped.`);continue;}const sex=cols.sex>=0?normalizeSex(sheet.get(r,cols.sex)):currentSex;if(!sex){warnings.push(`Row ${r+1} (${name}) has no recognizable sex value or Male/Female section marker and was skipped.`);continue;}const age=cols.age>=0?normalizeAge(sheet.get(r,cols.age)):'',birthDate=cols.birth>=0?excelSerialToIso(sheet.get(r,cols.birth)):'';seen.add(lrn);learners.push({lrn,name,sex,age,birthDate,row:r+1});}
  if(!learners.length)return null;const meta=sf1Meta(sheet),metaCount=Object.values(meta).filter(v=>text(v)).length,confidence=Math.min(100,header.score+(sexEvidence?5:0)+(metaCount>=2?5:0));return{sheet,header,learners,warnings,meta,confidence};}
function parseSf1(filePath,ctx){const sheets=loadWorkbook(filePath,ctx),candidates=sheets.map(parseSf1Sheet).filter(Boolean).sort((a,b)=>b.confidence-a.confidence||b.learners.length-a.learners.length);if(!candidates.length)throw new Error('No compatible SF1 roster was detected. The importer looked for an LRN column together with learner-name fields and valid 12-digit learner rows.');const best=candidates[0];if(best.confidence<80)throw new Error('An SF1-like worksheet was found, but its structure is too ambiguous to import safely.');if(candidates[1]&&candidates[1].confidence===best.confidence&&candidates[1].learners.length===best.learners.length)best.warnings.push(`More than one worksheet looked like an SF1. “${best.sheet.name}” was selected because it appeared first among the strongest matches.`);const male=best.learners.filter(x=>x.sex==='M').length,female=best.learners.filter(x=>x.sex==='F').length;return{format:path.extname(filePath).toLowerCase()==='.xls'?'compatible-sf1-xls':'compatible-sf1-xlsx',sheetName:best.sheet.name,headerRow:best.header.row+1,meta:best.meta,learners:best.learners,counts:{total:best.learners.length,male,female},warnings:best.warnings,detection:{mode:'bounded-flexible',confidence:best.confidence,sheetName:best.sheet.name,recognized:['LRN','Learner Name','Sex/section']}};}

function isClassRecord(t){return t.includes('class record');}
function isHps(t){return t.includes('highest possible score')||t==='hps'||t.startsWith('hps ');}
function isLearners(t){return t.includes('learner')&&t.includes('name');}
function isWw(t){return (t.includes('written')&&(t.includes('work')||t.includes('oral')))||/^wws?$/.test(t)||t.includes('written works');}
function isPt(t){return (t.includes('performance')&&t.includes('task'))||(t.includes('product')&&t.includes('task'))||/^pts?$/.test(t);}
function isExam(t){return t.includes('examination')||t.includes('quarterly assessment')||t.includes('quarterly exam')||/^exs?$/.test(t)||t==='exam'||t==='qa';}
function findAnchors(sheet,pred,maxRows=60,maxCols=180){const out=[];for(let r=0;r<=Math.min(sheet.maxRow,maxRows);r++)for(let c=0;c<=Math.min(sheet.maxCol,maxCols);c++){const t=semantic(sheet.get(r,c));if(t&&pred(t))out.push({r,c,t,raw:text(sheet.get(r,c))});}return out;}
function findBestEcrStructure(sheet){const hpss=findAnchors(sheet,isHps),learners=findAnchors(sheet,isLearners),wws=findAnchors(sheet,isWw),pts=findAnchors(sheet,isPt),exs=findAnchors(sheet,isExam),titles=findAnchors(sheet,isClassRecord);let best=null;for(const hps of hpss)for(const ln of learners){if(ln.r<hps.r||ln.r>hps.r+8)continue;for(const ww of wws)for(const pt of pts)for(const ex of exs){if(!(ww.c<pt.c&&pt.c<ex.c))continue;if(ww.r>hps.r||pt.r>hps.r||ex.r>hps.r)continue;const rowSpread=Math.max(ww.r,pt.r,ex.r)-Math.min(ww.r,pt.r,ex.r);if(rowSpread>4)continue;let score=85-rowSpread*2;const title=titles.find(x=>x.r<hps.r+1);if(title)score+=10;if(ln.r===hps.r+1)score+=3;const cand={hps,ln,ww,pt,ex,title,score};if(!best||cand.score>best.score)best=cand;}}return best;}
function headerTextForCol(sheet,c,r0,r1){const parts=[];for(let r=Math.max(0,r0);r<=Math.min(sheet.maxRow,r1);r++){const v=text(sheet.get(r,c));if(v)parts.push(v);}return semantic(parts.join(' '));}
function isSummaryHeader(t){return t.includes('total')||t==='ps'||t.includes('percentage score')||t==='ws'||t.includes('weighted score')||t.includes('initial grade')||t.includes('term grade')||t.includes('quarterly grade')||t==='descriptor';}
function rawLabelMatch(t,kind){if(!t)return false;if(/^\d{1,2}$/.test(t))return true;if(kind==='WW'&&( /\bww\s*\d+\b/.test(t)||/written work\s*\d+/.test(t)))return true;if(kind==='PT'&&( /\bpt\s*\d+\b/.test(t)||/performance task\s*\d+/.test(t)))return true;if(kind==='EXAM'&&( /\bst\s*\d+\b/.test(t)||t==='te'||t==='qa'||/exam\s*\d+/.test(t)||t==='quarterly assessment'))return true;return false;}
function detectRawColumns(sheet,catRow,hpsRow,start,end,kind,expected){const direct=[];for(let c=start;c<=end;c++){const t=headerTextForCol(sheet,c,catRow+1,hpsRow-1);if(rawLabelMatch(t,kind)&&!isSummaryHeader(t))direct.push(c);}if(direct.length===expected)return direct;const candidates=[];for(let c=start;c<=end;c++){const t=headerTextForCol(sheet,c,catRow+1,hpsRow-1);if(isSummaryHeader(t))continue;const hv=numberOrBlank(sheet.get(hpsRow,c));if(rawLabelMatch(t,kind)||(hv!==''&&t))candidates.push(c);}const uniq=[...new Set(candidates)].sort((a,b)=>a-b);if(uniq.length>=expected)return uniq.slice(0,expected);return direct;}
function findWsColumn(sheet,catRow,hpsRow,start,end){for(let c=end;c>=start;c--){const t=headerTextForCol(sheet,c,catRow+1,hpsRow-1);if(t==='ws'||t.includes('weighted score'))return c;}return-1;}
function findHeaderColumn(sheet,r0,r1,c0,c1,pred){for(let c=c0;c<=c1;c++){const t=headerTextForCol(sheet,c,r0,r1);if(pred(t))return c;}return-1;}
function ecrMeta(sheet){return{region:findMetaValue(sheet,['Region']),division:findMetaValue(sheet,['Division','Schools Division']),schoolId:findMetaValue(sheet,['School ID','School Id No']),schoolName:findMetaValue(sheet,['School Name','Name of School']),schoolYear:findMetaValue(sheet,['School Year','SY']),gradeLevel:findMetaValue(sheet,['Grade Level','Grade']),teacher:findMetaValue(sheet,['Teacher','Teacher Name','Name of Teacher']),subject:findMetaValue(sheet,['Subject','Learning Area']),section:findMetaValue(sheet,['Section'])};}
function detectTerm(sheet,structure){const scan=[];if(structure.title)scan.push(structure.title.raw);scan.push(sheet.name);for(let r=0;r<=Math.min(sheet.maxRow,20);r++)scan.push(sheet.rowText(r,0,Math.min(sheet.maxCol,80)));for(const s of scan){const t=semantic(s);let m=t.match(/term\s*([123])/);if(m)return Number(m[1]);if(t.includes('first term')||t.includes('1st term'))return 1;if(t.includes('second term')||t.includes('2nd term'))return 2;if(t.includes('third term')||t.includes('3rd term'))return 3;}return 1;}
function detectNameColumn(sheet,learnerRow,firstScoreCol){const scores=[];for(let c=0;c<firstScoreCol;c++){let count=0;for(let r=learnerRow+1;r<=Math.min(sheet.maxRow,learnerRow+250);r++){const v=text(sheet.get(r,c)),t=semantic(v);if(!v||isExcelError(v)||t==='male'||t==='female'||/^\d+$/.test(t)||isLearners(t))continue;if(/[a-zA-Z\u00C0-\u024F]/.test(v))count++;}if(count)scores.push({c,count});}scores.sort((a,b)=>b.count-a.count||b.c-a.c);if(!scores.length)return-1;if(scores[1]&&scores[0].count===scores[1].count&&scores[0].count<3)return-1;return scores[0].c;}
function detectSexMarkers(sheet,learnerRow,firstScoreCol){const markers=[];for(let r=learnerRow+1;r<=Math.min(sheet.maxRow,learnerRow+300);r++){const s=semantic(sheet.rowText(r,0,Math.max(0,firstScoreCol-1)));if(s==='male'||s==='male learners'||s==='boys')markers.push({r,sex:'M'});else if(s==='female'||s==='female learners'||s==='girls')markers.push({r,sex:'F'});else{for(let c=0;c<firstScoreCol;c++){const t=semantic(sheet.get(r,c));if(t==='male'){markers.push({r,sex:'M'});break;}if(t==='female'){markers.push({r,sex:'F'});break;}}}}return markers;}
function sexForRow(markers,row){let sex='';for(const m of markers){if(m.r>row)break;sex=m.sex;}return sex;}
function parseEcrSheet(sheet){const st=findBestEcrStructure(sheet);if(!st)return null;const warnings=[];const wwStart=st.ww.c,ptStart=st.pt.c,exStart=st.ex.c;const nextAfterExam=Math.min(sheet.maxCol,exStart+20);const wwCols=detectRawColumns(sheet,st.ww.r,st.hps.r,wwStart,ptStart-1,'WW',5),ptCols=detectRawColumns(sheet,st.pt.r,st.hps.r,ptStart,exStart-1,'PT',3),exCols=detectRawColumns(sheet,st.ex.r,st.hps.r,exStart,nextAfterExam,'EXAM',3);if(wwCols.length!==5||ptCols.length!==3||exCols.length!==3)return{sheet,structure:st,unsupported:true,reason:`Detected ECR structure on “${sheet.name}”, but the raw-score component pattern was ${wwCols.length} WW / ${ptCols.length} PT / ${exCols.length} Exam instead of the app's supported 5 / 3 / 3 pattern.`,confidence:st.score};const firstScore=Math.min(...wwCols),nameCol=detectNameColumn(sheet,st.ln.r,firstScore);if(nameCol<0)return{sheet,structure:st,unsupported:true,reason:`Detected an ECR-like worksheet on “${sheet.name}”, but the learner-name column could not be identified safely.`,confidence:st.score};const markers=detectSexMarkers(sheet,st.ln.r,firstScore);if(!markers.length)warnings.push('Male/Female section markers were not detected. Existing learners can still be matched by name, but new learners without a known sex cannot be added safely.');const wwWs=findWsColumn(sheet,st.ww.r,st.hps.r,wwStart,ptStart-1),ptWs=findWsColumn(sheet,st.pt.r,st.hps.r,ptStart,exStart-1),exWs=findWsColumn(sheet,st.ex.r,st.hps.r,exStart,nextAfterExam);const weight=(c)=>{if(c<0)return'';const n=numberOrBlank(sheet.get(st.hps.r,c));if(n==='')return'';return n>1.000001?n/100:n;};const swCols=[];for(let c=exStart;c<=nextAfterExam;c++){const t=headerTextForCol(sheet,c,st.ex.r+1,st.hps.r-1);if((t.includes('ws st')||t.includes('weighted score st')||t.includes('ws te')||t.includes('weighted score te'))&&!exCols.includes(c))swCols.push(c);}const subWeights=swCols.slice(0,3).map(c=>{const n=numberOrBlank(sheet.get(st.hps.r,c));return n===''?'':(n>0&&n<=1.000001?n*100:n);});while(subWeights.length<3)subWeights.push('');if(wwWs<0)warnings.push('Written Works category weight was not found, so the current app weight will be preserved.');if(ptWs<0)warnings.push('Performance Tasks category weight was not found, so the current app weight will be preserved.');if(exWs<0)warnings.push('Examination category weight was not found, so the current app weight will be preserved.');const initCol=findHeaderColumn(sheet,st.ex.r,st.hps.r,exStart,Math.min(sheet.maxCol,exStart+30),t=>t.includes('initial grade')),termCol=findHeaderColumn(sheet,st.ex.r,st.hps.r,exStart,Math.min(sheet.maxCol,exStart+35),t=>t.includes('term grade')||t.includes('quarterly grade')||t==='grade');const students=[];let namelessScoreRows=0;for(let r=st.ln.r+1;r<=Math.min(sheet.maxRow,st.ln.r+350);r++){const name=text(sheet.get(r,nameCol));const scores={WW:wwCols.map(c=>numberOrBlank(sheet.get(r,c))),PT:ptCols.map(c=>numberOrBlank(sheet.get(r,c))),EXAM:exCols.map(c=>numberOrBlank(sheet.get(r,c)))};const hasScores=[...scores.WW,...scores.PT,...scores.EXAM].some(v=>v!=='');if(!name){if(hasScores)namelessScoreRows++;continue;}const nt=semantic(name);if(nt==='male'||nt==='female'||isLearners(nt)||/^\d+$/.test(nt))continue;if(isExcelError(name)){warnings.push(`Row ${r+1} has an unresolved Excel value instead of a learner name and was skipped.`);continue;}const sex=sexForRow(markers,r);students.push({name,sex,row:r+1,scores,officialInitialGrade:initCol>=0?numberOrBlank(sheet.get(r,initCol)):'',officialTermGrade:termCol>=0?numberOrBlank(sheet.get(r,termCol)):''});}
  if(namelessScoreRows)warnings.push(`${namelessScoreRows} row${namelessScoreRows===1?'':'s'} contained scores without a learner name and were skipped.`);if(!students.length)return{sheet,structure:st,unsupported:true,reason:`The worksheet “${sheet.name}” has ECR headings but no readable learner names.`,confidence:st.score};const hps=(cols)=>cols.map(c=>numberOrBlank(sheet.get(st.hps.r,c)));const meta=ecrMeta(sheet),confidence=Math.min(100,st.score+(students.length?5:0));return{sheet,structure:st,confidence,warnings,data:{template:'compatible-ecr',termNo:detectTerm(sheet,st),meta,categories:{WW:{weight:weight(wwWs),hps:hps(wwCols)},PT:{weight:weight(ptWs),hps:hps(ptCols)},EXAM:{weight:weight(exWs),hps:hps(exCols),subWeights}},students,warnings,detection:{mode:'bounded-flexible',confidence,sheetName:sheet.name,recognized:['Highest Possible Score','Learner Names','Written Works','Performance Tasks','Examinations']}}};}
function parseEcr(filePath,ctx){if(path.extname(filePath).toLowerCase()!=='.xlsx')throw new Error('ECR import currently accepts macro-free .xlsx workbooks only.');const sheets=parseXlsxWorkbook(filePath,ctx.fs),cands=sheets.map(parseEcrSheet).filter(Boolean).sort((a,b)=>b.confidence-a.confidence);const valid=cands.filter(x=>x.data);if(!valid.length){const strongest=cands[0];if(strongest&&strongest.reason)throw new Error(strongest.reason);throw new Error('No compatible ECR worksheet was detected. The importer looked for learner names, HPS, Written Works, Performance Tasks and Examination sections.');}const best=valid[0];if(best.confidence<85)throw new Error('An ECR-like worksheet was found, but its structure is too ambiguous to import safely.');if(valid[1]&&valid[1].confidence===best.confidence)best.data.warnings.push(`More than one worksheet looked like an ECR. “${best.sheet.name}” was selected as the first strongest match.`);return best.data;}

module.exports = { parseSf1, parseEcr, _test: { semantic, MatrixSheet, detectSf1Header, findBestEcrStructure, parseSf1Sheet, parseEcrSheet } };
