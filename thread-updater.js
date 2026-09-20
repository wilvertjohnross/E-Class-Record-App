'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const UPDATE_EXT = '.ecrupdate';
const MAX_PACKAGE_BYTES = 150 * 1024 * 1024;
const MAX_UNCOMPRESSED_BYTES = 200 * 1024 * 1024;
const MAX_ENTRY_BYTES = 64 * 1024 * 1024;
const MAX_ENTRIES = 100;
const UPDATE_KEY_ID = 'ecr-dev-2026-02';
const UPDATE_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAea8+D6VYCljkLJshiTBc42KG5+CmjQWpjJuJb2SND3U=
-----END PUBLIC KEY-----`;

function versionParts(v) {
  return String(v || '0')
    .trim()
    .replace(/^v/i, '')
    .split(/[-+]/)[0]
    .split('.')
    .map(x => Number.parseInt(x, 10) || 0);
}

function compareVersions(a, b) {
  const aa = versionParts(a);
  const bb = versionParts(b);
  const n = Math.max(aa.length, bb.length, 3);
  for (let i = 0; i < n; i++) {
    const av = aa[i] || 0;
    const bv = bb[i] || 0;
    if (av > bv) return 1;
    if (av < bv) return -1;
  }
  return 0;
}

function sha256Buffer(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function readJsonSafe(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const st = fs.statSync(filePath);
    if (!st.isFile() || st.size > 2 * 1024 * 1024) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tmp, filePath);
}


function canonicalManifestBytes(manifest) {
  const orderedFiles = {};
  const files = manifest && manifest.files && typeof manifest.files === 'object' ? manifest.files : {};
  for (const key of Object.keys(files).sort()) orderedFiles[key] = String(files[key]).toLowerCase();
  const payload = {
    format: manifest.format,
    appId: manifest.appId,
    productName: manifest.productName || '',
    version: String(manifest.version || ''),
    minBootstrapVersion: String(manifest.minBootstrapVersion || ''),
    channel: String(manifest.channel || ''),
    createdAt: String(manifest.createdAt || ''),
    files: orderedFiles
  };
  return Buffer.from(JSON.stringify(payload), 'utf8');
}

function verifyManifestSignature(manifest) {
  const sig = manifest && manifest.signature;
  if (!sig || sig.algorithm !== 'ed25519' || sig.keyId !== UPDATE_KEY_ID || typeof sig.value !== 'string') {
    throw new Error('This update is not signed by the trusted E-Class Record development key.');
  }
  let signature;
  try { signature = Buffer.from(sig.value, 'base64'); } catch { throw new Error('The update signature is malformed.'); }
  if (!signature.length || !crypto.verify(null, canonicalManifestBytes(manifest), UPDATE_PUBLIC_KEY_PEM, signature)) {
    throw new Error('Update signature verification failed. Do not install this package.');
  }
}

function validateManifestFileMap(manifest) {
  if (!manifest.files || typeof manifest.files !== 'object' || Array.isArray(manifest.files)) {
    throw new Error('The signed update manifest does not contain a valid file map.');
  }
  const keys = Object.keys(manifest.files);
  if (!keys.length || keys.length > MAX_ENTRIES) throw new Error('The update manifest contains an invalid number of files.');
  for (const name of keys) {
    const safeName = safeZipRelativeName(name);
    if (!safeName || safeName !== name || !safeName.startsWith('payload/')) throw new Error(`Unsafe manifest file path: ${name}`);
    if (!/^[a-f0-9]{64}$/i.test(String(manifest.files[name] || ''))) throw new Error(`Invalid SHA-256 hash for ${name}.`);
  }
}

function safeZipRelativeName(name) {
  const raw = String(name || '').replace(/\\/g, '/');
  if (!raw || raw.includes('\0') || raw.startsWith('/') || raw.includes(':') || raw.includes('//')) return null;
  const segments = raw.split('/');
  if (segments.some(seg => !seg || seg === '.' || seg === '..')) return null;
  const normalized = path.posix.normalize(raw);
  if (normalized !== raw || normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) return null;
  return normalized;
}

class ThreadUpdater {
  constructor({ app, AdmZip, productName, appId, packagedRoot }) {
    this.app = app;
    this.AdmZip = AdmZip;
    this.productName = productName;
    this.appId = appId;
    this.packagedRoot = packagedRoot;
    this.bootstrapVersion = app.getVersion();
    this.baseDir = path.join(app.getPath('userData'), 'thread-updates');
    this.versionsDir = path.join(this.baseDir, 'versions');
    this.pendingFile = path.join(this.baseDir, 'pending.json');
    this.activeFile = path.join(this.baseDir, 'active.json');
    this.processedFile = path.join(this.baseDir, 'processed.json');
    this.active = null;
    this.pending = null;
    this.timer = null;
    this.onStatus = null;
  }

  ensureFolders() {
    fs.mkdirSync(this.baseDir, { recursive: true });
    fs.mkdirSync(this.versionsDir, { recursive: true });
  }

  currentVersion() {
    return this.active && compareVersions(this.active.version, this.bootstrapVersion) > 0
      ? this.active.version
      : this.bootstrapVersion;
  }

  info() {
    return {
      mode: 'local-thread-downloads',
      bootstrapVersion: this.bootstrapVersion,
      effectiveVersion: this.currentVersion(),
      activeVersion: this.active ? this.active.version : null,
      stagedVersion: this.pending ? this.pending.version : null,
      downloadsFolder: this.app.getPath('downloads'),
      updateExtension: UPDATE_EXT,
      developmentChannel: true,
      note: 'Only Ed25519-signed .ecrupdate packages from the trusted development key are accepted; valid packages are staged and become active on the next normal app launch.'
    };
  }

  emitStatus(status) {
    const payload = { ...this.info(), ...status, at: new Date().toISOString() };
    if (typeof this.onStatus === 'function') {
      try { this.onStatus(payload); } catch {}
    }
    return payload;
  }

  async initialize() {
    this.ensureFolders();
    this.loadActive();
    this.pending = readJsonSafe(this.pendingFile);

    // If an update was downloaded while the app was closed, detect it before
    // creating the window so it can become active immediately on this launch.
    await this.scanDownloadedUpdates({ quiet: true });
    this.promotePending();
    this.loadActive();
    this.pending = readJsonSafe(this.pendingFile);
    return this.info();
  }

  loadActive() {
    const active = readJsonSafe(this.activeFile);
    if (!active || !active.version) {
      this.active = null;
      return;
    }
    // A newer full installer supersedes any older runtime overlay.
    if (compareVersions(active.version, this.bootstrapVersion) <= 0) {
      this.active = null;
      return;
    }
    const versionDir = path.join(this.versionsDir, active.version);
    const manifest = readJsonSafe(path.join(versionDir, 'manifest.json'));
    if (!manifest || manifest.appId !== this.appId || manifest.version !== active.version || !this.verifyVersionDirectory(versionDir, manifest)) {
      this.active = null;
      return;
    }
    this.active = { ...active, manifest, versionDir, payloadDir: path.join(versionDir, 'payload') };
  }

  promotePending() {
    const pending = readJsonSafe(this.pendingFile);
    if (!pending || !pending.version) return false;
    const versionDir = path.join(this.versionsDir, pending.version);
    const manifest = readJsonSafe(path.join(versionDir, 'manifest.json'));
    if (!manifest || manifest.appId !== this.appId || manifest.version !== pending.version || !this.verifyVersionDirectory(versionDir, manifest)) {
      try { fs.unlinkSync(this.pendingFile); } catch {}
      this.pending = null;
      return false;
    }

    const activeVersion = this.active ? this.active.version : this.bootstrapVersion;
    if (compareVersions(pending.version, activeVersion) <= 0 || compareVersions(pending.version, this.bootstrapVersion) <= 0) {
      try { fs.unlinkSync(this.pendingFile); } catch {}
      this.pending = null;
      return false;
    }

    writeJsonAtomic(this.activeFile, {
      version: pending.version,
      activatedAt: new Date().toISOString(),
      sourceFile: pending.sourceFile || null
    });
    try { fs.unlinkSync(this.pendingFile); } catch {}
    this.pending = null;
    return true;
  }

  resolveResource(relativePath) {
    const rel = safeZipRelativeName(String(relativePath || '').replace(/\\/g, '/'));
    if (!rel) throw new Error('Unsafe application resource path.');
    if (this.active && this.active.payloadDir) {
      const candidate = path.join(this.active.payloadDir, ...rel.split('/'));
      if (fs.existsSync(candidate)) return candidate;
    }
    return path.join(this.packagedRoot, ...rel.split('/'));
  }

  extensionPath() {
    if (this.active && this.active.payloadDir) {
      const p = path.join(this.active.payloadDir, 'main-extension.js');
      if (fs.existsSync(p)) return p;
    }
    const bundled = path.join(this.packagedRoot, 'main-extension.js');
    return fs.existsSync(bundled) ? bundled : null;
  }

  verifyVersionDirectory(versionDir, manifest) {
    try {
      this.validateManifest(manifest);
      for (const [safeName, expected] of Object.entries(manifest.files)) {
        const rel = safeName.slice('payload/'.length);
        const filePath = path.join(versionDir, 'payload', ...rel.split('/'));
        const st = fs.statSync(filePath);
        if (!st.isFile() || st.size > MAX_ENTRY_BYTES) return false;
        const actual = sha256Buffer(fs.readFileSync(filePath));
        if (actual.toLowerCase() !== String(expected).toLowerCase()) return false;
      }
      return true;
    } catch { return false; }
  }

  processedMap() {
    return readJsonSafe(this.processedFile) || {};
  }

  markProcessed(filePath, stat, result) {
    const map = this.processedMap();
    map[path.resolve(filePath)] = {
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      checkedAt: new Date().toISOString(),
      result
    };
    const keys = Object.keys(map);
    if (keys.length > 100) {
      keys.sort((a, b) => new Date(map[b].checkedAt) - new Date(map[a].checkedAt));
      for (const k of keys.slice(100)) delete map[k];
    }
    writeJsonAtomic(this.processedFile, map);
  }

  wasProcessed(filePath, stat) {
    const item = this.processedMap()[path.resolve(filePath)];
    return !!item && item.size === stat.size && item.mtimeMs === stat.mtimeMs;
  }

  validateManifest(manifest) {
    if (!manifest || manifest.format !== 1) throw new Error('Unsupported update package format.');
    if (manifest.appId !== this.appId) throw new Error('This update belongs to a different application.');
    if (manifest.productName && manifest.productName !== this.productName) throw new Error('Update product name does not match this application.');
    if (!/^\d+\.\d+\.\d+(?:\.\d+)?(?:[-+][0-9A-Za-z.-]+)?$/.test(String(manifest.version || ''))) {
      throw new Error('The update package has an invalid version number.');
    }
    if (manifest.minBootstrapVersion && compareVersions(this.bootstrapVersion, manifest.minBootstrapVersion) < 0) {
      throw new Error(`This update needs bootstrap ${manifest.minBootstrapVersion} or newer. Install a newer full setup once.`);
    }
    validateManifestFileMap(manifest);
    verifyManifestSignature(manifest);
  }

  async stagePackage(filePath, { quiet = false } = {}) {
    let stat;
    try { stat = fs.statSync(filePath); } catch { return { ok: false, skipped: true }; }
    if (!stat.isFile()) return { ok: false, skipped: true };
    if (stat.size > MAX_PACKAGE_BYTES) {
      const result = { ok: false, error: 'Update package is too large.' };
      this.markProcessed(filePath, stat, result);
      return result;
    }
    if (this.wasProcessed(filePath, stat)) return { ok: true, skipped: true, alreadyChecked: true };

    try {
      const zip = new this.AdmZip(filePath);
      const manifestEntry = zip.getEntry('manifest.json');
      if (!manifestEntry) throw new Error('manifest.json is missing from the update package.');
      const manifestSize=Number(manifestEntry.header && manifestEntry.header.size || 0);
      if(!Number.isFinite(manifestSize)||manifestSize<=0||manifestSize>1024*1024) throw new Error('Update manifest exceeds the 1 MB safety limit.');
      const manifest = JSON.parse(manifestEntry.getData().toString('utf8'));
      this.validateManifest(manifest);

      const effective = this.currentVersion();
      const existingPending = readJsonSafe(this.pendingFile);
      const maxKnown = existingPending && compareVersions(existingPending.version, effective) > 0
        ? existingPending.version : effective;
      if (compareVersions(manifest.version, maxKnown) <= 0) {
        const result = { ok: true, skipped: true, version: manifest.version, reason: 'not-newer' };
        this.markProcessed(filePath, stat, result);
        return result;
      }

      const entries = zip.getEntries();
      if (entries.length > MAX_ENTRIES + 10) throw new Error('Update package contains too many entries.');
      let totalUncompressed = 0;
      const payloadEntries = [];
      for (const entry of entries) {
        const safeName = safeZipRelativeName(entry.entryName);
        if (!safeName) throw new Error('Unsafe file path found inside update package.');
        const declaredSize = Number(entry.header && entry.header.size || 0);
        if (!Number.isFinite(declaredSize) || declaredSize < 0 || declaredSize > MAX_ENTRY_BYTES) throw new Error(`Update entry is too large: ${safeName}`);
        totalUncompressed += declaredSize;
        if (totalUncompressed > MAX_UNCOMPRESSED_BYTES) throw new Error('Update package expands beyond the allowed size.');
        if (safeName === 'manifest.json' || entry.isDirectory) continue;
        if (!safeName.startsWith('payload/')) throw new Error(`Unexpected file in update package: ${safeName}`);
        if (!Object.prototype.hasOwnProperty.call(manifest.files, safeName)) throw new Error(`Unsigned payload file found: ${safeName}`);
        payloadEntries.push({ entry, safeName });
      }
      if (!payloadEntries.length) throw new Error('The update package has no payload files.');
      const actualNames = payloadEntries.map(x => x.safeName).sort();
      const signedNames = Object.keys(manifest.files).sort();
      if (actualNames.length !== signedNames.length || actualNames.some((n, i) => n !== signedNames[i])) {
        throw new Error('Update payload does not exactly match the signed manifest.');
      }

      const tempDir = path.join(this.versionsDir, `.staging-${manifest.version}-${Date.now()}`);
      fs.mkdirSync(tempDir, { recursive: true });
      try {
        fs.writeFileSync(path.join(tempDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
        for (const { entry, safeName } of payloadEntries) {
          const rel = safeName.slice('payload/'.length);
          const dest = path.join(tempDir, 'payload', ...rel.split('/'));
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          const buf = entry.getData();
          const expected = manifest.files[safeName];
          if (sha256Buffer(buf).toLowerCase() !== String(expected).toLowerCase()) {
            throw new Error(`Integrity check failed for ${safeName}.`);
          }
          fs.writeFileSync(dest, buf);
        }

        const finalDir = path.join(this.versionsDir, manifest.version);
        fs.rmSync(finalDir, { recursive: true, force: true });
        fs.renameSync(tempDir, finalDir);
      } catch (err) {
        fs.rmSync(tempDir, { recursive: true, force: true });
        throw err;
      }

      const pending = {
        version: manifest.version,
        sourceFile: filePath,
        stagedAt: new Date().toISOString()
      };
      writeJsonAtomic(this.pendingFile, pending);
      this.pending = pending;
      const result = { ok: true, staged: true, version: manifest.version, sourceFile: filePath };
      this.markProcessed(filePath, stat, result);
      if (!quiet) this.emitStatus({ type: 'update-staged', message: `Version ${manifest.version} is ready for the next normal app launch.` });
      return result;
    } catch (err) {
      const result = { ok: false, error: err.message };
      this.markProcessed(filePath, stat, result);
      if (!quiet) this.emitStatus({ type: 'update-error', message: err.message, sourceFile: filePath });
      return result;
    }
  }

  async scanDownloadedUpdates({ quiet = false } = {}) {
    this.ensureFolders();
    const folder = this.app.getPath('downloads');
    let names = [];
    try { names = fs.readdirSync(folder); } catch { return { ok: false, error: 'Downloads folder could not be read.' }; }
    const candidates = names
      .filter(n => n.toLowerCase().endsWith(UPDATE_EXT))
      .map(n => path.join(folder, n))
      .filter(p => { try { return fs.statSync(p).isFile(); } catch { return false; } })
      .sort((a, b) => { try { return fs.statSync(a).mtimeMs - fs.statSync(b).mtimeMs; } catch { return 0; } });

    const results = [];
    for (const filePath of candidates) results.push(await this.stagePackage(filePath, { quiet }));
    this.pending = readJsonSafe(this.pendingFile);
    return { ok: true, checked: candidates.length, results, ...this.info() };
  }

  startWatching({ intervalMs = 8000, onStatus } = {}) {
    this.onStatus = onStatus || this.onStatus;
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => {
      this.scanDownloadedUpdates({ quiet: false }).catch(() => {});
    }, Math.max(5000, intervalMs));
    if (this.timer && typeof this.timer.unref === 'function') this.timer.unref();
  }

  stopWatching() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

module.exports = { ThreadUpdater, compareVersions, UPDATE_EXT };
