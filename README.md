# KLAS v1.5.8

Offline Windows class-record application with separate teaching and adviser workspaces.

## Current release

v1.5.8 adds the official shield/book/sun logo with the KLAS wordmark and Kattokong hat. The complete Windows x64 installer includes all v1.5.1–v1.5.7 functionality: keyboard score entry, page shortcuts, class switching, subject icons, manual/uploaded adviser grades and automatic Class Record detection.

The development folder is no longer used for update discovery in distributed installations; each user's Downloads folder is used. Personal checked/approved signatory defaults are blank for newly created classes. Existing saved records retain their values.

## Build

Use Node.js and npm on Windows:

```powershell
npm ci
npm run dist
```

The installer is generated at `dist/KLAS-Setup-1.5.8.exe`. Electron and electron-builder versions are pinned in package.json/package-lock.json. The shortcut is named KLAS. Existing application identity and storage paths are retained for compatibility.

The installer has no Windows publisher certificate. Internal `.ecrupdate` signatures use a separate trust mechanism and do not establish Windows publisher signing.

## Validation and limits

See VALIDATION-v1.5.8.md and the per-version release/validation notes. SF5 and SF10 remain placeholder pages. Microsoft Excel desktop is used for official form rendering/printing. Real installation and printing on colleagues' machines still require hands-on evaluation.

Generated installers, update bundles, local records, dependencies and private signing material are excluded from this repository. The colleague installer was delivered separately to the Desktop.
