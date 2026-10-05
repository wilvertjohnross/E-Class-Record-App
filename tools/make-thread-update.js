'use strict';

// Developer helper for creating signed KLAS compatibility updates.
// The .ecrupdate extension and ECLASS_UPDATE_SIGNING_KEY environment variable
// remain unchanged during the v1.7.x compatibility window so existing trusted
// bootstraps continue to recognize the package.
// Usage:
//   set ECLASS_UPDATE_SIGNING_KEY=C:\secure\ECR_UPDATE_SIGNING_PRIVATE_KEY.pem
//   node tools/make-thread-update.js 1.7.0 path\to\payload KLAS-v1.7.0.ecrupdate
// IMPORTANT: payload is the complete changed-runtime set, not app/** only.
// Include every changed root runtime file (for example main-extension.js),
// changed app/** files, and any changed templates/resources.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const AdmZip = require('adm-zip');

const TRUSTED_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEADMMuLpesA2YkU1SAXBLKeY34h8boZkFrMVolpehdB7A=
-----END PUBLIC KEY-----`;
const MAX_FILES = 100;
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_TOTAL_BYTES = 200 * 1024 * 1024;

const [version, payloadArg, outputArg] = process.argv.slice(2);
const signingKeyPath = process.env.ECLASS_UPDATE_SIGNING_KEY ? path.resolve(process.env.ECLASS_UPDATE_SIGNING_KEY) : null;
if (!version || !payloadArg || !outputArg || !signingKeyPath) {
  console.error('Usage: set ECLASS_UPDATE_SIGNING_KEY=<private-key.pem> then node tools/make-thread-update.js <version> <payload-folder> <output.ecrupdate>');
  process.exit(2);
}

if (!/^\d+\.\d+\.\d+(?:\.\d+)?(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) { console.error('Invalid semantic version:', version); process.exit(2); }
if (!String(outputArg).toLowerCase().endsWith('.ecrupdate')) { console.error('Output file must use the .ecrupdate extension.'); process.exit(2); }

if (!fs.existsSync(signingKeyPath)) { console.error('Signing key was not found:', signingKeyPath); process.exit(2); }
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

const payloadItems = walk(payloadRoot);
if (!payloadItems.length || payloadItems.length > MAX_FILES) { console.error(`Payload must contain 1-${MAX_FILES} files.`); process.exit(2); }
let declaredTotal = 0;
const requiredRuntimeCandidates = ['app/index.html', 'app/app.js', 'main-extension.js'];
if (!requiredRuntimeCandidates.some(rel => payloadItems.some(item => item.rel === rel))) {
  console.error('Payload does not contain a recognized KLAS runtime entry. Refusing to create an app-only/empty-style update.');
  process.exit(2);
}
for (const item of payloadItems) {
  if (path.resolve(item.full) === signingKeyPath) { console.error('Refusing to package the private signing key. Move it outside the payload folder.'); process.exit(2); }
  if (!item.rel || item.rel.startsWith('/') || item.rel.split('/').some(seg=>!seg||seg==='.'||seg==='..') || item.rel.includes(':')) { console.error('Unsafe payload path:', item.rel); process.exit(2); }
  const st = fs.statSync(item.full);
  if (st.size > MAX_FILE_BYTES) { console.error('Payload file exceeds 64 MB:', item.rel); process.exit(2); }
  declaredTotal += st.size;
  if (declaredTotal > MAX_TOTAL_BYTES) { console.error('Payload exceeds the 200 MB safety limit.'); process.exit(2); }
}

const zip = new AdmZip();
const files = {};
for (const item of payloadItems) {
  const buf = fs.readFileSync(item.full);
  const zipName = `payload/${item.rel}`;
  zip.addFile(zipName, buf);
  files[zipName] = hash(buf);
}

const manifest = {
  format: 1,
  appId: 'ph.edu.eclassrecord.gs.sf9',
  productName: 'KLAS',
  version,
  minBootstrapVersion: '1.7.0',
  channel: 'chat-thread-local-development',
  createdAt: new Date().toISOString(),
  files
};
function canonicalManifestBytes(m) {
  const orderedFiles = {};
  for (const key of Object.keys(m.files || {}).sort()) orderedFiles[key] = String(m.files[key]).toLowerCase();
  return Buffer.from(JSON.stringify({
    format:m.format, appId:m.appId, productName:m.productName || '', version:String(m.version || ''),
    minBootstrapVersion:String(m.minBootstrapVersion || ''), channel:String(m.channel || ''),
    createdAt:String(m.createdAt || ''), files:orderedFiles
  }), 'utf8');
}
const privateKey = fs.readFileSync(signingKeyPath, 'utf8');
let derivedPublic;
try { derivedPublic = crypto.createPublicKey(crypto.createPrivateKey(privateKey)).export({type:'spki',format:'pem'}).toString().trim(); }
catch (err) { console.error('Signing key is not a valid private key:', err.message); process.exit(2); }
if (derivedPublic !== TRUSTED_PUBLIC_KEY.trim()) { console.error('Signing key does not match the public key trusted by bootstrap v1.1.5.'); process.exit(2); }
manifest.signature = { algorithm:'ed25519', keyId:'ecr-dev-2026-09-12', value:crypto.sign(null, canonicalManifestBytes(manifest), privateKey).toString('base64') };
zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'));
fs.mkdirSync(path.dirname(output), { recursive: true });
zip.writeZip(output);
console.log('Created:', output);
console.log('Version:', version);
console.log('Files:', Object.keys(files).length);
