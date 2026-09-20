E-Class Record App with GS and SF9
Version 1.1.3



VERSION 1.1.3 — SF2 DEPED-COMPLIANT MARKINGS / COMPACT PRINT ROWS
- Restores the original SF2 official template from the v1.1.0/v1.1.1 integration line.
- Attendance working view follows the template legend: blank Present; full-box X Absent; upper half shaded Late Comer/Tardy; lower half shaded Cutting Classes.
- Click cycle: Present -> Absent -> Late/Tardy -> Cutting Classes -> Present.
- Keyboard shortcuts: P/Space, X/A, L/T, C.
- Official output uses drawing-layer marks so the X reaches the box corners and half-cell shading covers the correct half of the official cell.
- Generated SF2 files hide unused learner rows according to the current SF1/current roster. The bundled official template remains unchanged; only generated copies are compacted for preview/printing.
- Fixed capacity remains 21 Male rows, 25 Female rows, and 25 school-day columns; overflow still produces a non-blocking warning.
- Existing v1.1.0/v1.1.1/v1.1.2 data and v1.0.27-era backups remain compatible.
- No grading, transmutation, ECR, GS, SF9, IPC-security, updater-signature, or local-persistence changes.



VERSION 1.1.2 — SIMPLIFIED SF2 X / T ATTENDANCE MARKING
- Replaces the bundled SF2 output template with the newly supplied School Form 2 workbook, byte-for-byte; no static wording, layout, merges, borders, dimensions, logos, or print setup in that uploaded template is edited by this release.
- Simplifies the SF2 working-view marking cycle to: blank = Present → X = Absent → T = Tardy → blank = Present.
- Uses one whole-day attendance mark per learner per school day; there is no AM/PM split and Cutting Classes is no longer a selectable attendance state.
- Keyboard shortcuts are P/Space for Present, X/A for Absent, and T for Tardy.
- Official SF2 output writes uppercase X and T into the full daily attendance cell.
- Keeps the existing v1.1.x local JSON attendance schema stable: the prior L code is retained internally as the tardy storage code, while legacy C records are interpreted as Tardy so existing SF2 data is not lost.
- Existing v1.1.0/v1.1.1 SF2 data and backups remain import-compatible; grading, ECR, GS, SF9 calculations, and Electron/updater security architecture are unchanged.
- This is a focused patch release on the v1.1.x SF2 line.

VERSION 1.1.1 — SF2 INPUT / METADATA REGRESSION FIX
- Fixes the v1.1.0 official-output metadata validator so the boolean class property sf2Enabled is accepted as valid metadata.
- Restores Official SF2 generation for SF2-enabled advisory classes.
- Also prevents the same sf2Enabled property from breaking Official ECR / Grading Sheet output.
- No grading, transmutation, attendance, SF9, template-layout, or saved-data schema changes.
- Existing v1.1.0 SF2 data and v1.0.27-era data remain compatible.
- Validation/input notices remain non-blocking; the fix does not add modal validation dialogs.
- This is a patch release on the v1.1.x line.

VERSION 1.1.0 — SF2 DAILY ATTENDANCE INTEGRATION
- First feature-level release after the v1.0.x stabilization line.
- Adds app-owned School Form 2 (SF2) Daily Attendance for advisory classes.
- SF2 is opt-in per class from Setup → SF2 / Advisory Class, so ordinary subject classes are not forced to maintain attendance.
- Uses the uploaded official School Form 2 workbook as the fixed final-output template.
- Attendance codes in the working screen: blank = Present, × = Absent, upper-half mark = Late Comer, lower-half mark = Cutting Classes.
- School days are selectable per reporting month; weekdays are preselected and holidays/suspensions can be removed.
- Calculates monthly absences, tardiness, daily M/F totals, enrolment percentage, ADA, attendance percentage, and learners with 5 consecutive absences.
- SF2 attendance automatically feeds the corresponding June–April SF9 attendance month; SF9 attendance cells for maintained SF2 months become read-only to prevent conflicting records.
- Official SF2 output supports Preview, Save XLSX, Open in Excel, and Print through the existing Excel-to-PDF preview engine.
- Official SF2 template capacity in this supplied page is preserved: up to 25 school days, 21 Male rows, and 25 Female rows.
- SF2 data is saved in the same local JSON database and included in Export/Import Backup validation.
- The app remains the logic engine; the official SF2 workbook is used only as the presentation/output shell.
- Because v1.1.0 adds new main-process IPC actions, install it as a full bootstrap/installer build. Future 1.1.x patches can use the signed local-update mechanism.

VERSION 1.0.27 — DARK MODE VISUAL OPTIMIZATION
- Cumulative full source package suitable for generating a Windows installer.
- Includes v1.0.26 two-decimal PS/WS presentation changes.
- Includes v1.0.25 non-blocking raw-score validation/recovery behavior.
- Dark mode uses centrally controlled semantic theme tokens and WCAG-AA-oriented contrast.
- Official ECR/GS templates and app-owned grading/output logic remain bundled.
- Existing data under Documents\E-Class Record App with GS and SF9 is preserved by upgrades.

WINDOWS INSTALLER BUILD
1. Extract this ZIP to a normal writable folder.
2. Install Node.js LTS if needed.
3. Double-click BUILD_WINDOWS.bat.
4. The generated NSIS installer will be placed in the dist folder.

VERSION 1.0.20 — STABILITY & SECURITY GATE
This is a one-time full bootstrap update. It consolidates the v1.0.19 clean-slate
ECR runtime into the installed application and hardens the desktop shell before
new school-record modules are added. Existing data in Documents\E-Class Record
App with GS and SF9 is preserved.

Key changes:
- Official ECR remains formula-free and external-link-free. The app is the logic engine.
- Disk saves are acknowledged only after the main process writes and verifies the JSON file.
- A rolling eclass-record-data.previous.json recovery copy is maintained.
- Local browser recovery data carries a revision/timestamp so a newer unsaved-to-disk copy
  can win over an older desktop file on the next launch.
- Raw score entry is constrained to 0..HPS; lowering HPS below an existing score is blocked.
- Official ECR/GS creation is blocked when category weights, HPS, custom item weights, or
  stored raw scores are invalid.
- Custom Examination PS follows the official ECR architecture: each item contribution is
  rounded to two decimals before the contributions are summed.
- Main-window navigation is locked to the trusted local application page.
- Renderer JavaScript is externalized and protected by a Content Security Policy.
- Backup JSON is structurally validated, bounded, and checked for prototype-pollution keys.
- Summary import is size-bounded. Cached preview files are checked for PDF/XLSX signatures.
- New identifiers use crypto.randomUUID() where available.
- adm-zip is upgraded to 0.6.0.
- Roster CSV import is transactional: a rejected oversized file cannot leave a partially modified roster.
- Backup school-logo data is format-checked before it can re-enter the renderer.

SIGNED DEVELOPMENT UPDATES
Starting with bootstrap v1.0.20, .ecrupdate files must carry an Ed25519 signature made
with the project development signing key. The installed app contains ONLY the public key.
The private signing key must never be copied into the app source tree, installer, school
computer deployment folder, or a distributed .ecrupdate file.

Future runtime updates created with tools\make-thread-update.js require:
  set ECLASS_UPDATE_SIGNING_KEY=C:\secure\ECR_UPDATE_SIGNING_PRIVATE_KEY.pem
  node tools\make-thread-update.js <version> <payload-folder> <output.ecrupdate>

Unsigned old development updates are intentionally rejected by v1.0.20.

WINDOWS BUILD
1. Keep your existing Documents data folder; do not delete it.
2. Install Node.js LTS if needed.
3. Double-click BUILD_WINDOWS.bat.
4. Run the generated v1.0.20 installer.
5. Existing class/learner/grade data remains under Documents and is reused.

DESKTOP DATA
Working file:
  Documents\E-Class Record App with GS and SF9\eclass-record-data.json
Recovery copy:
  Documents\E-Class Record App with GS and SF9\eclass-record-data.previous.json
Daily backups:
  Documents\E-Class Record App with GS and SF9\Backups\

VERSION 1.0.8 — IMPORT OFFICIAL SF1 (.XLS)
The Roster tab now accepts the official School Form 1 (SF1) Excel 97-2004
workbook directly. There is no need to convert the official SF1 to CSV.

In Roster, click:
  Import Official SF1 (.xls)

The importer detects the official SF1 LRN/NAME header row and reads:
- Learner name
- 12-digit LRN
- Age
- Sex
- Birth date (stored with the learner record for future use)

The SF1 is treated as the authoritative source for learner identity. Existing
learners are matched by LRN first, then by normalized name when the existing
learner has no conflicting LRN. Matching learners keep their internal app ID,
so existing Term scores, other subject grades, attendance, comments and SF9
data remain attached while the official SF1 name/LRN/age/sex are refreshed.
Missing learners are added automatically.

Before import, the app displays a roster preview and detected learner counts.
The optional "Remove current learners who are not listed in this SF1" setting
is OFF by default. When enabled, those learners and their stored class/SF9 data
are removed; leaving it off performs a safe merge.

The importer also detects basic SF1 class metadata for the preview (school,
school year, grade level and section), but v1.0.8 does not overwrite the class
Setup fields with those values.

SF1 import is implemented by the app itself and does not require Microsoft
Excel to be installed. Version 1.0.8 targets the legacy .xls SF1 format used by
the supplied official file. The uploaded SF1 itself is not bundled into the
application or installer.


VERSION 1.0.7 — IMPORT FILLED OFFICIAL ECR (.XLSX)
The Class Record import workflow now accepts an already-filled Excel workbook
that uses the SAME official ECR template bundled with this app. A separate CSV
score file is no longer required for Class Record importing.

In Term 1, Term 2, or Term 3, click:
  Import Official ECR (.xlsx)

The app reads the fixed official-template cells directly and imports:
- Detected term
- Region, Division, School ID, School Name, School Year
- Grade Level, Section, Teacher and Subject
- HPS and grading weights
- Male/Female learner names from the official learner blocks
- Raw WW1-WW5, PT1-PT3, ST1, ST2 and TE scores

Existing learners are matched by normalized name and missing learners are added
to the roster. Raw scores for matching learners in the detected term are
replaced by the workbook values. Other terms are not changed. LRN and age are
not imported because the official ECR template has no fields for them.

PS, WS, Initial Grade, Term Grade and Descriptor are recalculated by the app
from the imported raw scores rather than blindly copying potentially stale
Excel formula results. If cached Excel Term Grades are available, the importer
compares them with the app result and reports discrepancies as a verification
check.

The importer validates that the selected workbook matches the official ECR
layout. If learner names are supplied only through unresolved external Excel
links and no cached names are present, open the workbook in Excel with its
source links available and save it once before importing.

OFFICIAL CLASS RECORD TEMPLATE EXPORT IN v1.0.5
The Class Record view now uses the supplied official Excel template for filing
and printing instead of relying on the app's HTML Class Record printout.

In Class Record view:
- Download Official ECR (.xlsx) fills a fresh copy of the bundled official
  template and lets you choose where to save it.
- Open Official ECR for Printing creates the filled workbook and opens it in
  your computer's default spreadsheet application (normally Microsoft Excel),
  where you can use the template's own print layout.
- Grading Sheet printing remains the app's existing native print workflow.

The master template is bundled at:
  templates\ECR official Template.xlsx
It is never overwritten. Every export is a fresh copy.

The official template has fixed capacity/columns: 50 male learners, 50 female
learners, 5 WW components, 3 PT components, and 3 Examination components. The
app checks these requirements before export.

The original template contains links to a separate INPUT DATA / HELPER workbook.
v1.0.5 deliberately replaces those linked formulas with the values already
computed by the app, then removes the external-link metadata from the exported
copy. This makes each exported ECR standalone and avoids broken-link warnings.
The original template formatting, merged cells, logos, page setup, margins and
print area are preserved.

VERSION 1.0.4 — LEGACY CSV SCORE IMPORT
Earlier builds used a mapped CSV score importer in the Class Record. Starting
with v1.0.7, the Class Record toolbar uses the filled official ECR .xlsx import
instead.

SCHOOL LOGO IN v1.0.3
Setup includes Upload / Change School Logo for the app's Class Record, Grading
Sheet and SF9 views. The official v1.0.5 ECR export preserves the logos that are
already part of the supplied official Excel template.

NEW CLASS FIX IN v1.0.2
+ New Class and Roster > Paste names use in-app dialogs instead of unsupported
browser prompt() dialogs.

PRINTING FIX IN v1.0.1
The in-app print functions use Electron's native Windows printing API.

WINDOWS BUILD
1. Install Node.js LTS on a Windows computer.
2. Double-click BUILD_WINDOWS.bat.
3. The script installs the required dependencies.
4. It builds the Windows installer.
5. The completed installer is placed in and opens the dist folder.

Manual build commands:
  npm install
  npm run dist

RUN FOR TESTING
  npm install
  npm start

DESKTOP DATA
The installed application stores its working data under:
Documents\E-Class Record App with GS and SF9\eclass-record-data.json

Automatic daily backups are stored under:
Documents\E-Class Record App with GS and SF9\Backups\

Generated official ECR files opened for printing are stored under:
Documents\E-Class Record App with GS and SF9\Official ECR Exports\

Upgrading or uninstalling the program does not delete the gradebook data folder.


VERSION 1.0.6 - OFFICIAL ECR PRINT PREVIEW
In Class Record view, click "Official ECR Print Preview". On Windows computers with desktop Microsoft Excel installed, the app creates a filled copy of the bundled official ECR workbook and opens Excel directly in Print Preview. This avoids Electron/Chromium's unsupported browser print-preview page while preserving the official template's print settings. If desktop Excel is unavailable, the app opens the generated workbook normally instead.
