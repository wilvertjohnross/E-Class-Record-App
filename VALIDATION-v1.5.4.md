# KLAS v1.5.4 validation

Baseline: KLAS v1.5.3 source in an isolated copy. Synthetic data only; installed records were not accessed.

## Executed

- grading-navigation.cjs: all three GS buttons and corresponding editable record launchers, no record/sheet switch, no Final Grades launcher in Class Overview, retained Final Grades in Term Grades.
- adviser-grade-links.cjs: explicit selection, read-only linked Summary values, matching SF9 values, live score changes, saved manual grade preservation, duplicate/conflicting learner handling, deleted-source blanks, blocked linked-subject imports, link persistence on reload, dropdown label/bold selected class, unlink restoring manual grades, no adviser Class Records tile and no renderer errors.
- Existing sidebar/class-switching, page-scroll and keyboard/grid regression suites rerun.
- Source syntax and archive byte parity checked by packaging script. Grading/transmutation sections and bootstrap/preload/updater/signing helper compared to v1.5.3. Runtime payload retains 20 required files. No private keys packaged or accessed.

## Inspected and not executed

SF9 preview builds from the same reportCardHtml/areaRowResult path verified by the grade-link test. Existing backup validation clones metadata, retaining link IDs. Native installed-app backup roundtrip, Excel output, physical printing, update activation and Windows dropdown option font rendering are not proven by browser tests.

## Windows hands-on

1. Sign/install the patch and verify v1.5.4.
2. Select a teaching class for a subject in Adviser Summary. Verify the intended school year/section/subject, linked grades and SF9 preview; inspect unmatched warnings.
3. Close/reopen and export/import a disposable backup; verify links and records persist.
4. Check GS launch placement, native dropdown bold text, and printing at your Windows display scaling.

Missing/ambiguous source learners are intentionally blank while linked. Unlink to restore existing manual/imported adviser grades. The update remains unsigned until the local signing workflow is run. Existing bootstrap startup folder-scan limitations are unchanged.
