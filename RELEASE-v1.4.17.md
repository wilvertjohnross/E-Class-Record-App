# KLAS v1.4.17 — include missing importer dependency

Fixes SF1 import failing with Cannot find module './flex-importers.js' when main-extension.js runs from an installed update directory. The updater now includes the unchanged flex-importers.js beside main-extension.js. The source package build.files also includes flex-importers.js for future full builds. The previous three-file updater payload was incomplete; future cumulative patches must retain all four files below.

Payload: app/app.js, app/index.html, flex-importers.js, main-extension.js.

Validation: extracted the actual ready-to-sign ZIP into an isolated directory, loaded its main-extension.js, invoked the real SF1 import action with file selection stubbed to a synthetic XLSX workbook, and verified the parsed learner name and LRN. The existing XLSX parsing and import entry point ran without modification. Relative runtime dependencies checked; flex-importers.js requires built-in path and the bootstrap-provided adm-zip dependency. Renderer/importer/runtime syntax checks passed; ZIP entries and byte parity verified. This was not a test of the user's workbook or a signed updater installation. Private key not accessed; no signed updater produced.

Sign locally using Sign-KLAS-v1.4.17.ps1, wait for KLAS to detect the update in outputs and restart. Then retry Upload SF1. All v1.4.16 behavior is retained.
