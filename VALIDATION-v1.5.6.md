# KLAS v1.5.6 validation

Baseline: isolated copy of v1.5.5 source. Automated tests use synthetic learners only.

Executed focused tests:
- adviser-grade-links.cjs: automatic detection; restored SF10 tile; no manual selectors or grade inputs; live Summary/SF9 grades; wrong-subject legacy links ignored; wrong year/section rejected; duplicate eligible classes flagged; unmatched learners blank; full-roster matching required when section is missing; detected grades protected from import; duplicate learner safety; persistence and automatic Advisory Class labels after reload. No renderer errors.
- grading-navigation.cjs: all three Grading Sheet launchers and separate record views; Final Grades placement.
- class-overview.cjs: existing adviser field, class switching, learner counts, centered cards at five widths and no horizontal overflow.

Package checks verify JavaScript syntax, version, 20 runtime files, source/payload byte parity and unchanged grading/transmutation sections. Bootstrap, preload, updater and signing helper compared to v1.5.5. Private signing material and dependency/build directories excluded from archives.

The signed update is verified separately against the trusted public key and every declared payload hash; its checksum is added to SHA256SUMS after verification. No installed-app activation, real student data, physical printing or complete school-form regression was performed.

Windows hands-on checklist:
1. Install/restart and confirm v1.5.6.
2. Check automatic subject detection against the SF1 masterlist and correct school year/grade/section. Inspect missing-match notices and duplicate-class conflicts.
3. Confirm a changed teaching score appears in Adviser Summary and SF9 preview; verify actual printing separately.
4. Confirm SF10 navigation is restored, noting that official SF10 functionality remains unfinished.

No formulas, SF1 learner identities or stored manual grades are rewritten by automatic detection. When no class is detected, existing imported/saved grades remain available; ambiguous detected records do not silently fall back to those grades.
