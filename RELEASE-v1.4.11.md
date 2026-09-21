# KLAS v1.4.11 — development update folder

Includes the Grading Weights refinements and trash-can buttons from the preceding release.

The runtime extension redirects KLAS's app-local Electron downloads path to:
C:\Users\Teacher\Documents\Codex\2026-09-21\files-pasted-by-the-user-continue\outputs

The existing update watcher (every eight seconds), manual scan, update status and folder shortcut use that path. Windows Downloads, user data paths, application identity, signature verification and grading logic are unchanged. If the folder cannot be created/configured, KLAS logs the error and retains Downloads.

Bootstrap compatibility: the installed bootstrap runs its first startup scan before loading the runtime extension. That early scan still uses Downloads. Once the extension loads, the watcher and manual scans use outputs. Updates discovered there are staged for the next restart. Use Help > Install Local Update File... once to install this release from outputs. Legacy menu labels still say Check Downloaded Updates / Open Downloads Folder, but both use outputs while this release is active.

Payload (three runtime files):
- app/app.js
- app/index.html
- main-extension.js

All three are included because this updater selects files from the active version and otherwise falls back to the installed bootstrap, rather than merging prior update folders. Future updater payloads must retain this extension and the current renderer files to preserve these changes.

Validation: JavaScript syntax passed. An isolated Electron run outside the restricted sandbox started v1.4.11, reported the exact requested scan path, manually scanned three existing .ecrupdate files in outputs, loaded synthetic v1.4.8 records, and persisted/reloaded an HPS edit through desktop IPC with no renderer JavaScript errors. No production records or private signing key were accessed. The preceding UI/grading tests are documented in RELEASE-v1.4.10.md; grading code is unchanged in this release. No new signed updater was generated or installed; end-to-end installation remains a local user step.

Run Sign-KLAS-v1.4.11.ps1 with the two ZIPs beside it. It invokes the unchanged repository signing tool with version 1.4.11 and your existing local signing key. Output: KLAS-v1.4.11.ecrupdate.
