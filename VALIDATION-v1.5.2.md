# KLAS v1.5.2 validation

## Baseline and scope

Built from KLAS-v1.5.1-source.zip, derived from v1.5.0 main commit 3d6c91188e541b25961119254cff99c0cf232925. Work used an isolated extracted source directory and disposable synthetic browser data. Installed teacher/student data was not opened or modified.

## Executed checks

- tests/sidebar-class-switching.cjs: five grouped checks passed in headless Microsoft Edge. Covered switching between two synthetic classes on eight subject pages while retaining the active route; correct learner display; adviser separation; clickable logo; single visible sidebar version; fixed examination controls; HPS edit and reload; preserved legacy exam configuration; WW/PT controls; transactional rejection of conflicting imported examination weights; matching-weight preflight acceptance; both themes and navigation/picker separation at 320, 390, 980 and 1440 pixels. No renderer errors.
- tests/class-record-keyboard.cjs: all 12 grouped v1.5.1 regressions passed again. Covered WW/PT maximums and legacy counts, safe deletion, ECR/GS workbook generation with reduced item counts, all three term keyboard grids, invalid-entry handling, focus, reload persistence, shortcut configuration and native-menu lifecycle fixture.
- Rendered the actual Term Grades page at 1280x900 and visually inspected the sidebar holder, version and class picker placement. This was a browser render, not a running installed Electron app.
- JavaScript syntax, source/payload ZIP byte parity, runtime dependencies and version identity checked. Bootstrap, preload, updater and signing-helper contents remain unchanged from v1.5.1. Grading calculation and transmutation source sections remain unchanged.
- Source/package paths and content checked to exclude dependencies, build products and private signing material. No private signing key was accessed. Signing script parsed without executing it.

## Boundaries and Windows hands-on checklist

1. Sign the payload locally, stage/restart the installed app and confirm v1.5.2 in the sidebar. Verify native Help > Keyboard Shortcuts > Edit Page Shortcuts.
2. In a disposable class, switch classes from each teaching page, edit HPS and scores, close/reopen the desktop app and confirm disk persistence.
3. Check native window resizing and Windows scaling at 100%, 125% and 150%, including the logo, version stamp, class picker and keyboard focus.
4. Preview/print ECR, Grading Sheet and school forms in the actual Excel/printer environment. This patch did not execute physical printing or a complete school-form regression.

Actual installed-bootstrap application, signatures, native menus, disk persistence and Excel/printing were not verified end to end. The existing updater trust mechanism is unchanged; the ready-to-sign ZIP is not a signed update. The known startup update-folder scan limitation remains: a patch placed in the configured outputs folder while the app is closed may stage after opening and require another restart. No bootstrap replacement is claimed.
