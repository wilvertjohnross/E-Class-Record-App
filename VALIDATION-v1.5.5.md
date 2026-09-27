# KLAS v1.5.5 validation

Baseline: v1.5.4 source, copied to an isolated v1.5.5 draft.

Executed: tests/class-overview.cjs passed with synthetic classes, confirming use of the existing adviser field rather than the subject teacher name, class-switching updates, accurate learner counts and visible count badge, centered cards at 1440, 980, 600, 390 and 320 pixels, no horizontal overflow and no renderer errors. A browser screenshot was reviewed; a hidden-badge CSS rule found during review was corrected and the test rerun successfully.

Packaging checks: JavaScript syntax, source/payload byte parity, version identity and 20 runtime payload files. Grading/transmutation source sections and bootstrap/preload/updater/signing-helper files compared with v1.5.4. Build dependencies and private signing material excluded.

Signing is performed separately by the existing local workflow; successful signature and payload hash verification are reported on completion and the signed file is added to SHA256SUMS. This source report does not claim installation or Windows-native visual verification.

Remaining hands-on check: install the signed update, restart, confirm v1.5.5; switch between classes and verify adviser name, school year, learner counts and centered cards at your actual Windows display scaling. Installed data was not used in automated tests. No commit or push performed.
