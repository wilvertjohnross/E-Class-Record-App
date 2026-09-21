# KLAS v1.4.10 release and validation

Baseline: E-Class-Record-App-main.zip (package.json 1.4.7), overlaid with the two runtime files from KLAS-v1.4.8.ecrupdate. The 1.4.8 Ed25519 signature and both SHA-256 hashes were verified using the repository's existing public key. This is a reconstructed source baseline; the supplied update contains no other runtime files.

Changes: WW/PT item-weight controls removed; EX custom controls retained; HPS headings and compact legends; responsive cards; specified Subject Teacher notice removed; affected helper text shortened. Source package version is 1.4.10. Runtime footer version comes from the signed update manifest, as before.

Payload contains exactly:
- app/app.js
- app/index.html

The source ZIP also updates package.json and includes this release report. Main/preload, updater, signing tool, internal app identity, storage paths, import/export logic, assets and official templates are unchanged. Calculation functions and data schema are unchanged. Legacy WW/PT custom modes and subWeight properties remain intact; their existing calculation behavior is retained.

Validation passed:
- JavaScript syntax check.
- Electron launch using original main/preload, normal graphics settings, and separate workspace test-data folders.
- v1.4.8 synthetic class/learner/encoded-score fixture loaded; HPS edited through the desktop IPC bridge, saved to disk, then reloaded.
- No renderer JavaScript errors in browser or successful Electron test.
- WW/PT/EX headers and custom-control visibility; add/remove for all categories.
- HPS, category weights and EX item weights persist after reload; EX custom toggle works.
- Category-total warning appears at 105% and clears at 100%.
- Legacy WW/PT custom properties survive save/reload.
- 240 automatic/custom category calculation comparisons against v1.4.8; independent expected-result checks (70% automatic, 65% custom).
- Encoded term/final grade results match v1.4.8.
- 3/2/1-column layout and overflow checks at 1920, 1440, 1280, 1180, 1000, 821, 820, 768, 390 and 320 pixels; desktop/mobile screenshots visually inspected.
- KLAS branding retained and specified notice absent.

An initial Electron test inside the restricted automation environment failed to launch renderer/GPU subprocesses and produced the Windows breakpoint dialog. The same isolated test passed outside that sandbox, including with normal graphics settings. No application workaround or graphics flag was added to the release.

Limits: Tests used synthetic records, not the user's live data. Official Excel/template generation and every unrelated module were not exercised end to end; those files and calculation paths were left unchanged. No signed 1.4.10 updater was generated, installed, or tested. Signing and installation remain local user steps.

Signing: Keep the two ZIPs and Sign-KLAS-v1.4.10.ps1 together. Run the script with PowerShell. It extracts each ZIP to a new temporary folder, installs only production Node dependencies with lifecycle scripts disabled, and runs the unchanged tools/make-thread-update.js. The private key is read only by that tool during the user's local signing run and is never copied into the payload. The output is KLAS-v1.4.10.ecrupdate beside the script. An existing output is not overwritten.

UI follow-up: All Remove/Delete buttons now use the same trash-can icon, including grading items, learner rows and class deletion. Accessible names, hover tooltips, event handlers and existing confirmations are preserved. Syntax, grading/persistence/responsive regression checks and learner removal/class cancellation interaction checks passed after this change. The earlier Electron startup check predates this icon-only follow-up.

Version-only release preparation: promoted the previously validated icon revision from 1.4.9 to 1.4.10 so existing 1.4.9 installations can accept it. The validation above was performed on the preceding revision; this promotion changes source version metadata and a CSS comment only. App JavaScript is byte-identical. Archive contents, signing-script syntax, and source version are checked again. No private key was accessed and no signed updater was generated.
