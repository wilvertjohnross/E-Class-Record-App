'use strict';

const fs = require('fs');

const FREESECT = 0xFFFFFFFF;
const ENDOFCHAIN = 0xFFFFFFFE;
const FATSECT = 0xFFFFFFFD;
const DIFSECT = 0xFFFFFFFC;

function u32(buf, off) { return buf.readUInt32LE(off); }
function u16(buf, off) { return buf.readUInt16LE(off); }

function readOleWorkbookStream(filePath) {
  const buf = fs.readFileSync(filePath);
  const magic = Buffer.from([0xD0,0xCF,0x11,0xE0,0xA1,0xB1,0x1A,0xE1]);
  if (buf.length < 512 || !buf.subarray(0,8).equals(magic)) {
    throw new Error('The selected file is not a legacy Excel .xls workbook.');
  }

  const sectorShift = u16(buf, 30);
  const miniSectorShift = u16(buf, 32);
  const sectorSize = 1 << sectorShift;
  const miniSectorSize = 1 << miniSectorShift;
  const numFatSectors = u32(buf, 44);
  const firstDirSector = u32(buf, 48);
  const miniStreamCutoff = u32(buf, 56);
  const firstMiniFatSector = u32(buf, 60);
  const numMiniFatSectors = u32(buf, 64);
  const firstDifatSector = u32(buf, 68);
  const numDifatSectors = u32(buf, 72);

  function sectorBytes(sid) {
    if (sid >= 0xFFFFFFF0) throw new Error('Invalid OLE sector reference in the SF1 workbook.');
    const start = 512 + sid * sectorSize;
    const end = start + sectorSize;
    if (start < 512 || end > buf.length) throw new Error('The SF1 workbook contains an invalid OLE sector chain.');
    return buf.subarray(start, end);
  }

  const difat = [];
  for (let i=0;i<109;i++) {
    const sid = u32(buf, 76 + i*4);
    if (sid !== FREESECT) difat.push(sid);
  }
  let difSid = firstDifatSector;
  const difatEntriesPerSector = sectorSize/4 - 1;
  for (let n=0; n<numDifatSectors && difSid !== ENDOFCHAIN && difSid !== FREESECT; n++) {
    const sec = sectorBytes(difSid);
    for (let i=0;i<difatEntriesPerSector;i++) {
      const sid = u32(sec, i*4);
      if (sid !== FREESECT) difat.push(sid);
    }
    difSid = u32(sec, difatEntriesPerSector*4);
  }
  const fatSectorIds = difat.slice(0, numFatSectors).filter(sid => sid < 0xFFFFFFF0);
  if (!fatSectorIds.length) throw new Error('The SF1 workbook FAT could not be read.');
  const fat = [];
  for (const sid of fatSectorIds) {
    const sec = sectorBytes(sid);
    for (let off=0; off<sectorSize; off+=4) fat.push(u32(sec, off));
  }

  function readChain(startSid, table=fat, reader=sectorBytes) {
    if (startSid === ENDOFCHAIN || startSid === FREESECT) return Buffer.alloc(0);
    const chunks = [];
    const seen = new Set();
    let sid = startSid;
    while (sid !== ENDOFCHAIN && sid !== FREESECT && sid < 0xFFFFFFF0) {
      if (seen.has(sid)) throw new Error('The SF1 workbook contains a cyclic OLE sector chain.');
      seen.add(sid);
      if (sid >= table.length) throw new Error('The SF1 workbook contains an out-of-range OLE sector reference.');
      chunks.push(reader(sid));
      sid = table[sid];
    }
    return Buffer.concat(chunks);
  }

  const dirStream = readChain(firstDirSector);
  const directory = [];
  for (let off=0; off+128<=dirStream.length; off+=128) {
    const ent = dirStream.subarray(off, off+128);
    const nameLen = u16(ent, 64);
    const name = nameLen >= 2 ? ent.subarray(0, Math.min(64, nameLen-2)).toString('utf16le') : '';
    const type = ent[66];
    const startSector = u32(ent, 116);
    const lowSize = u32(ent, 120);
    const highSize = u32(ent, 124);
    const size = highSize ? highSize * 0x100000000 + lowSize : lowSize;
    directory.push({name, type, startSector, size});
  }
  const root = directory.find(e => e.type === 5);
  const book = directory.find(e => e.type === 2 && /^(Workbook|Book)$/i.test(e.name));
  if (!book) throw new Error('The Excel Workbook stream was not found in this .xls file.');

  if (book.size >= miniStreamCutoff) return readChain(book.startSector).subarray(0, book.size);

  if (!root || firstMiniFatSector === ENDOFCHAIN || !numMiniFatSectors) {
    throw new Error('The small Workbook stream in this .xls file could not be read.');
  }
  const miniFatBytes = readChain(firstMiniFatSector).subarray(0, numMiniFatSectors * sectorSize);
  const miniFat = [];
  for (let off=0; off+4<=miniFatBytes.length; off+=4) miniFat.push(u32(miniFatBytes, off));
  const miniStream = readChain(root.startSector).subarray(0, root.size);
  function miniSectorBytes(sid) {
    const start = sid * miniSectorSize;
    const end = start + miniSectorSize;
    if (start < 0 || end > miniStream.length) throw new Error('The SF1 workbook contains an invalid mini-sector reference.');
    return miniStream.subarray(start, end);
  }
  return readChain(book.startSector, miniFat, miniSectorBytes).subarray(0, book.size);
}

function parseBiffRecords(stream) {
  const out = [];
  let off = 0;
  while (off + 4 <= stream.length) {
    const id = u16(stream, off);
    const len = u16(stream, off+2);
    const end = off + 4 + len;
    if (end > stream.length) break;
    out.push({off, id, data: stream.subarray(off+4, end)});
    off = end;
  }
  return out;
}

class SegmentReader {
  constructor(segments) { this.segments = segments; this.si = 0; this.pos = 0; }
  current() { return this.segments[this.si] || Buffer.alloc(0); }
  advanceSegment() { this.si++; this.pos = 0; if (this.si >= this.segments.length) throw new Error('Unexpected end of Excel shared-string table.'); }
  readByte() {
    while (this.pos >= this.current().length) this.advanceSegment();
    return this.current()[this.pos++];
  }
  readBytes(n) {
    const chunks=[]; let remain=n;
    while (remain>0) {
      if (this.pos >= this.current().length) this.advanceSegment();
      const cur=this.current();
      const take=Math.min(remain, cur.length-this.pos);
      chunks.push(cur.subarray(this.pos,this.pos+take));
      this.pos += take; remain -= take;
    }
    return Buffer.concat(chunks,n);
  }
  readUInt16() { const b=this.readBytes(2); return b.readUInt16LE(0); }
  readUInt32() { const b=this.readBytes(4); return b.readUInt32LE(0); }
  readChars(count, highByte) {
    let remaining=count, high=!!highByte, out='';
    while (remaining>0) {
      const cur=this.current();
      const bytesPer=high?2:1;
      const available=cur.length-this.pos;
      const fit=Math.floor(available/bytesPer);
      if (fit<=0) {
        this.advanceSegment();
        // BIFF8 CONTINUE begins with a new compression flag only when the
        // character array itself continues into that record.
        high = (this.readByte() & 0x01) !== 0;
        continue;
      }
      const take=Math.min(remaining,fit);
      const raw=cur.subarray(this.pos,this.pos+take*bytesPer);
      out += raw.toString(high?'utf16le':'latin1');
      this.pos += take*bytesPer;
      remaining -= take;
      if (remaining>0 && this.pos>=cur.length) {
        this.advanceSegment();
        high = (this.readByte() & 0x01) !== 0;
      }
    }
    return out;
  }
}

function parseSharedStrings(records) {
  const idx = records.findIndex(r => r.id === 0x00FC); // SST
  if (idx < 0) return [];
  const sst = records[idx].data;
  if (sst.length < 8) return [];
  const unique = u32(sst,4);
  const segments=[sst.subarray(8)];
  for (let i=idx+1; i<records.length && records[i].id===0x003C; i++) segments.push(records[i].data);
  const rd=new SegmentReader(segments);
  const strings=[];
  for (let i=0;i<unique;i++) {
    const cch=rd.readUInt16();
    const flags=rd.readByte();
    const richRuns=(flags & 0x08)?rd.readUInt16():0;
    const extSize=(flags & 0x04)?rd.readUInt32():0;
    const text=rd.readChars(cch, flags & 0x01);
    if (richRuns) rd.readBytes(richRuns*4);
    if (extSize) rd.readBytes(extSize);
    strings.push(text);
  }
  return strings;
}

function decodeRk(rk) {
  const mult100=(rk & 1)!==0;
  const isInt=(rk & 2)!==0;
  let value;
  if (isInt) value=(rk>>2);
  else {
    const b=Buffer.alloc(8);
    b.writeUInt32LE(0,0);
    b.writeUInt32LE(rk & 0xFFFFFFFC,4);
    value=b.readDoubleLE(0);
  }
  return mult100?value/100:value;
}

function parseCells(records, sheetOffset, sst) {
  const cells=new Map();
  const key=(r,c)=>`${r}:${c}`;
  for (const rec of records) {
    if (rec.off < sheetOffset) continue;
    const p=rec.data;
    if (rec.id===0x00FD && p.length>=10) { // LABELSST
      const row=u16(p,0), col=u16(p,2), si=u32(p,6);
      cells.set(key(row,col), sst[si] ?? '');
    } else if (rec.id===0x027E && p.length>=10) { // RK
      cells.set(key(u16(p,0),u16(p,2)),decodeRk(u32(p,6)));
    } else if (rec.id===0x0203 && p.length>=14) { // NUMBER
      cells.set(key(u16(p,0),u16(p,2)),p.readDoubleLE(6));
    } else if (rec.id===0x00BD && p.length>=12) { // MULRK
      const row=u16(p,0), firstCol=u16(p,2), lastCol=u16(p,p.length-2);
      let pos=4;
      for (let col=firstCol; col<=lastCol && pos+6<=p.length-2; col++,pos+=6) {
        cells.set(key(row,col),decodeRk(u32(p,pos+2)));
      }
    } else if (rec.id===0x0006 && p.length>=14) { // FORMULA cached result
      const row=u16(p,0), col=u16(p,2);
      const result=p.subarray(6,14);
      // Special cached string/bool/error values begin with 0xFFFF in bytes 6-7.
      if (!(result[6]===0xFF && result[7]===0xFF)) cells.set(key(row,col),result.readDoubleLE(0));
    }
  }
  return { get:(r,c)=>cells.has(key(r,c))?cells.get(key(r,c)):'' };
}

function cleanText(v) {
  return String(v===null||v===undefined?'':v).replace(/\r/g,'').trim();
}
function norm(v) {
  return cleanText(v).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ');
}
function normalizeLrn(v) {
  if (typeof v==='number' && Number.isFinite(v)) return String(Math.trunc(v));
  return cleanText(v).replace(/\.0+$/,'').replace(/\D/g,'');
}
function normalizeAge(v) {
  const m=cleanText(v).match(/\d{1,2}/); return m?m[0]:'';
}
function normalizeSex(v) {
  const s=cleanText(v).toUpperCase(); return s.startsWith('F')?'F':s.startsWith('M')?'M':'';
}

function parseOfficialSf1Xls(filePath) {
  const stream=readOleWorkbookStream(filePath);
  const records=parseBiffRecords(stream);
  const bof=records[0];
  if (!bof || bof.id!==0x0809 || bof.data.length<2 || u16(bof.data,0)<0x0600) {
    throw new Error('The selected SF1 is not a supported Excel 97-2004 (.xls) workbook.');
  }
  let sheetOffset=null, sheetName='';
  for (const rec of records) {
    if (rec.id!==0x0085 || rec.data.length<8) continue;
    sheetOffset=u32(rec.data,0);
    const cch=rec.data[6], flags=rec.data[7];
    const raw=rec.data.subarray(8,8+cch*((flags&1)?2:1));
    sheetName=raw.toString((flags&1)?'utf16le':'latin1');
    break;
  }
  if (sheetOffset===null) throw new Error('No worksheet was found in the selected SF1 workbook.');
  const sst=parseSharedStrings(records);
  const cells=parseCells(records,sheetOffset,sst);

  // Detect the SF1 header from its labels rather than assuming one exact row.
  let header=null;
  for (let r=0;r<25 && !header;r++) {
    let lrnCol=-1,nameCol=-1,sexCol=-1,birthCol=-1,ageCol=-1;
    for (let c=0;c<60;c++) {
      const t=norm(cells.get(r,c));
      if (!t) continue;
      if (lrnCol<0 && (t==='lrn' || t.startsWith('lrn '))) lrnCol=c;
      if (nameCol<0 && t.includes('name') && (t.includes('last name') || t==='name')) nameCol=c;
      if (sexCol<0 && (t.includes('sex') || t==='m/f')) sexCol=c;
      if (birthCol<0 && t.includes('birth date')) birthCol=c;
      if (ageCol<0 && (t==='age' || t.startsWith('age ') || t.includes('age as of'))) ageCol=c;
    }
    if (lrnCol>=0 && nameCol>=0) header={row:r,lrnCol,nameCol,sexCol,birthCol,ageCol};
  }
  if (!header) throw new Error('This workbook does not appear to use the official SF1 layout (LRN/NAME headers were not found).');

  const learners=[];
  const seenLrn=new Set();
  const warnings=[];
  for (let r=header.row+1;r<header.row+250;r++) {
    const lrn=normalizeLrn(cells.get(r,header.lrnCol));
    const name=cleanText(cells.get(r,header.nameCol));
    if (!/^\d{12}$/.test(lrn) || !name) continue;
    if (seenLrn.has(lrn)) { warnings.push(`Duplicate LRN ${lrn} was found in the SF1; the later duplicate was skipped.`); continue; }
    seenLrn.add(lrn);
    const sex=header.sexCol>=0?normalizeSex(cells.get(r,header.sexCol)):'';
    const age=header.ageCol>=0?normalizeAge(cells.get(r,header.ageCol)):'';
    const birthDate=header.birthCol>=0?cleanText(cells.get(r,header.birthCol)):'';
    learners.push({lrn,name,sex:sex||'M',age,birthDate,row:r+1});
  }
  if (!learners.length) throw new Error('No 12-digit LRN learner rows were found in this SF1 workbook.');

  function findLabelValue(needles, maxRows=12, maxCols=55) {
    const wanted=needles.map(norm);
    for (let r=0;r<maxRows;r++) for (let c=0;c<maxCols;c++) {
      const t=norm(cells.get(r,c));
      if (!t || !wanted.some(w=>t===w || t.startsWith(w))) continue;
      for (let d=1;d<=10 && c+d<maxCols;d++) {
        const v=cleanText(cells.get(r,c+d));
        if (v) return v;
      }
    }
    return '';
  }
  let region='';
  for (let r=0;r<10 && !region;r++) for (let c=0;c<55;c++) {
    const v=cleanText(cells.get(r,c));
    if (/^Region\s+[IVX0-9-]+$/i.test(v)) { region=v; break; }
  }
  const meta={
    schoolId:findLabelValue(['School ID']),
    region,
    division:findLabelValue(['Division']),
    schoolName:findLabelValue(['School Name']),
    schoolYear:findLabelValue(['School Year']),
    gradeLevel:findLabelValue(['Grade Level']),
    section:findLabelValue(['Section'])
  };

  const male=learners.filter(x=>x.sex==='M').length;
  const female=learners.filter(x=>x.sex==='F').length;
  return {
    format:'official-sf1-xls', sheetName, headerRow:header.row+1,
    meta, learners, counts:{total:learners.length,male,female}, warnings
  };
}

module.exports={parseOfficialSf1Xls};
