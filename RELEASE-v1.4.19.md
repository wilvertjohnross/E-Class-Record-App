# KLAS v1.4.19 — provide SF1 template outside app.asar

The installed bootstrap resolves absent update resources to its app.asar archive. Electron can read that virtual path, but the external Excel process cannot open it. Include the unchanged templates/SF1 official Template.xls in the update payload so the updater resolves it to a real extracted file. No renderer, importer, grading logic or template-content changes from v1.4.18.

Payload: app/app.js, app/index.html, flex-importers.js, main-extension.js, templates/SF1 official Template.xls. Future cumulative updater packages must retain this template as well as the four runtime files.

Validation: extracted the ready-to-sign ZIP and ran isolated Electron with resource resolution directed to those extracted files, including its main-extension.js and template. Actual Excel generated a fresh SF1 XLS and PDF from synthetic learner data and opened the in-app preview (ok=true, cached=false). Test resolver simulated the active update directory; a signed updater installation was not performed. No actual printing, private-key access or production-data changes. Template bytes compared with v1.4.18 and verified unchanged. Earlier source-directory-only tests did not reproduce the installed archive path limitation.

Sign locally using Sign-KLAS-v1.4.19.ps1. Restart after staging, confirm v1.4.19, then retry Preview Official SF1. Reimport is unnecessary.
