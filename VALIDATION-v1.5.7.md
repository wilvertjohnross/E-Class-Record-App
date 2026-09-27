# KLAS v1.5.7 validation

Baseline: isolated copy of v1.5.6. User supplied all_subject_icons.zip contains 20 PNG files. Only synthetic learner data was used.

## Executed

- subject-icons-and-grades.cjs: eight and ten subject cards with 4+4 / 5+5 desktop rows; images load; elective image selection; MAPEH split components; enhanced subject labels; manual validation (including >100 and decimal rejection), final-grade averaging, SF9 resolved values, reload persistence, uploaded-grade override, detached backup preservation of grade-source preference, narrow window and theme checks; no renderer errors.
- adviser-grade-links.cjs: retained automatic matching and ambiguous/wrong-year/wrong-section protections, SF10 presence, live SF9 resolution, updated upload behavior and reload.
- sidebar-class-switching.cjs: eight teaching pages, fixed examination controls/import safety, class switching, adviser separation, themes and responsive controls.
- grading-navigation.cjs: three independent Class Record/Grading Sheet pairs and Final Grades placement.
- class-record-keyboard.cjs: all 12 existing grouped checks passed, including WW/PT legacy/max-count safety, ECR/GS generation, grid keyboard navigation/focus, saved grades, shortcut editor and menu lifecycle fixture.
- Regular/Special Science browser screenshots reviewed. Original icon artwork was not raster-edited. Layout checks measure layout positions to avoid hover-transform differences.

Packaging verifies syntax, source/payload byte parity, 40 runtime files (including 20 new icons), version identity, unchanged grading/transmutation sections and bootstrap/updater/signing-helper contents. Private signing material and build/dependency folders excluded. Local signing script validates the full expanded file list before signing.

## Not executed / hands-on

No signed package, installed-app activation, native file-picker upload, native Electron save/reopen, or physical Excel/printing verification is claimed. Test upload coverage executes the grade-import function using synthetic parsed rows; the actual Windows chooser/parser integration needs hands-on verification.

1. After signing/installing, confirm v1.5.7 and all icons on both class types.
2. Select both electives and Creative Technologies level in Class Type and Subject Settings.
3. Enter/upload a disposable subject's grades, verify SF9 preview and close/reopen persistence; switch back to a detected Class Record.
4. Check Windows scaling and actual printing. The existing SF10 page remains a placeholder.
