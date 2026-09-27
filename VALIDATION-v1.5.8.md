# KLAS v1.5.8 validation

Validated on Windows on 2026-09-27. This cumulative source release follows repository v1.5.0 and includes the documented v1.5.1–v1.5.7 changes.

## Executed checks

All seven regression suites in `tests/` passed against the release checkout using synthetic data and headless Microsoft Edge through Playwright:

- `adviser-grade-links.cjs`: adviser/teaching-class grade linking and matching safeguards.
- `class-overview.cjs`: overview content and layout.
- `class-record-keyboard.cjs`: 12 groups covering WW/PT limits, legacy counts, cross-term deletion protection, all-term cell navigation, validation, persistence and shortcut editing/menu integration.
- `grading-navigation.cjs`: three grading-sheet launchers, separate record/sheet views and Final Grades placement.
- `page-scroll.cjs`: one outer scroll area at 1424, 980 and 390 pixel widths, reachable final learner, preserved hidden LRN/age data and dark theme.
- `sidebar-class-switching.cjs`: class isolation on eight pages, transactional examination import checks, fixed examination controls, editable HPS, legacy preservation, sidebar identity and responsive layout.
- `subject-icons-and-grades.cjs`: regular/special subject layouts, MAPEH components, electives, manual grade validation, final/SF9 flow, reload, upload override, backup modes and mobile/theme checks.

Test tooling used an external Playwright installation and workspace dependencies through NODE_PATH; Playwright is not an application runtime dependency.

Built the complete x64 NSIS installer with Electron 44.2.0 and electron-builder 26.15.3. Verified the Desktop copy against the build SHA256 recorded in the release notes. Inspected the packaged app archive for required runtime modules, official templates, official logo and 20 subject images; no private key files, local backup files or application data files were packaged.

Launched the packaged app archive through an isolated Electron harness with temporary profile, Documents and Downloads directories. Confirmed startup, an empty roster and loaded branding without touching the user's installed profile. The harness uses the Electron runtime version for app.getVersion; the packaged manifest was separately verified as 1.5.8. This does not establish the installed application's displayed version.

Aligned the source lockfile root version with package.json at 1.5.8 and made the sidebar regression assertion read the package version instead of a historical literal.

## Remaining hands-on checks

- Run the installer wizard on an evaluation Windows machine; verify shortcuts, installed version and first launch.
- Check upgrade behavior with a recoverable backup of an existing profile and confirm existing records remain intact.
- Exercise Excel-dependent official exports/previews and physical printing, including page fit, logos and signatories.
- Verify local signed-update discovery and application from the installed bootstrap.

The installer is not Authenticode publisher-signed. No installer wizard, real-data migration, full Excel/printing regression or installed-bootstrap update cycle was executed for this release. Source/package inspection and browser tests do not substitute for these checks.
