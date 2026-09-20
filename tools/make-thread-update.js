'use strict';

// Developer helper for creating the .ecrupdate packages consumed by v1.0.9+.
// Usage:
//   node tools/make-thread-update.js 1.0.10 path\to\payload output.ecrupdate
// The payload directory can contain app/index.html, main-extension.js,
// templates/* and any other runtime files needed by that version.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const AdmZip = require('adm-zip');

const [version, payloadArg, outputArg] = process.argv.slice(2);
if (!version || !payloadArg || !outputArg) {
  console.error('Usage: node tools/make-thread-update.js <version> <payload-folder> <output.ecrupdate>');
  process.exit(2);
}

const payloadRoot = path.resolve(payloadArg);
const output = path.resolve(outputArg);
if (!fs.existsSync(payloadRoot) || !fs.statSync(payloadRoot).isDirectory()) {
  console.error('Payload folder was not found:', payloadRoot);
  process.exit(2);
}

function walk(dir, base = dir) {
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) out.push(...walk(full, base));
    else if (st.isFile()) out.push({ full, rel: path.relative(base, full).replace(/\\/g, '/') });
  }
  return out;
}

function hash(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

const zip = new AdmZip();
const files = {};
for (const item of walk(payloadRoot)) {
  const buf = fs.readFileSync(item.full);
  const zipName = `payload/${item.rel}`;
  zip.addFile(zipName, buf);
  files[zipName] = hash(buf);
}

const manifest = {
  format: 1,
  appId: 'ph.edu.eclassrecord.gs.sf9',
  productName: 'E-Class Record App with GS and SF9',
  version,
  minBootstrapVersion: '1.0.9',
  channel: 'chat-thread-local-development',
  createdAt: new Date().toISOString(),
  files
};
zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'));
fs.mkdirSync(path.dirname(output), { recursive: true });
zip.writeZip(output);
console.log('Created:', output);
console.log('Version:', version);
console.log('Files:', Object.keys(files).length);
