# v1.5.1 validation

Baseline: GitHub main commit `3d6c91188e541b25961119254cff99c0cf232925`, package version 1.5.0. Changes were made in an isolated checkout. No installed records were opened or modified.

## Executed

`tests/class-record-keyboard.cjs` passed 12 grouped regression checks in headless Microsoft Edge using synthetic learners:

- WW/PT add/remove controls at their maximums; empty-category recovery; legacy over-capacity preservation; protection for zero-valued scores in another term.
- Fewer WW/PT components passed the renderer payload and ECR/GS workbook generation engines.
- All three terms: Tab, Shift+Tab, Enter, Shift+Enter, male/female group boundary, inactive item skipping, bottom-row behavior and escape from the grid with native Tab.
- Invalid score restores the previous value and keeps focus. Mouse selection retains focus while computed cells refresh. Recorded values survive reload.
- Default shortcuts, editor opening, duplicate/reserved rejection, Cancel, saved reassignment and reload, Grading Sheet versus Class Record routing, and reset defaults.
- Shortcut editor at 320, 390, 980 and 1440 pixel widths; Escape dismissal; no renderer JavaScript errors.
- Help menu installation and deduplication tested with an Electron menu/lifecycle fixture. This is not a native installed-app menu test.

Numerical grading functions, averaging/rounding and transmutation tables were compared with v1.5.0 and remain text-identical after line-ending normalization. The surrounding input/navigation code changed; no formula changes were introduced.

The editor was rendered for visual review in light and dark themes. A narrow-input CSS conflict found during review was corrected so complete shortcut combinations are visible.

JavaScript syntax and Git whitespace checks were run. Packaging verifies source/payload byte parity, required runtime dependencies, version identity, exclusion of build/private files, and the unchanged bootstrap/public-key source. The existing signature trust mechanism was not changed. No v1.5.1 signature is claimed before local signing.

## Run the focused tests

Provide `playwright` and `adm-zip` through your Node environment, with Microsoft Edge installed, then run `node tests/class-record-keyboard.cjs`. All browser state is disposable; the suite does not open the installed app profile.

## Windows hands-on checks still required

1. Sign/stage the patch, restart the installed app, and confirm v1.5.1. Check Help → Keyboard Shortcuts → Edit Page Shortcuts in the native menu.
2. Check custom shortcuts on the actual keyboard layout and at Windows display scaling 100%, 125% and 150%. Confirm popup focus, visible shortcut text and scrolling.
3. With a disposable class, rapidly encode scores using Tab and Enter, then close/reopen the app and confirm disk persistence.
4. Preview/print an official ECR and GS with fewer WW/PT items in the actual Excel/printer environment. Workbook generation checks do not establish physical layout.

The existing startup update-folder scan limitation remains: an update placed in the configured outputs folder while the app is closed may stage after opening and require another restart. No bootstrap replacement was attempted.
