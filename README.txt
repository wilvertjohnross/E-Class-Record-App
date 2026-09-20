E-Class Record App with GS and SF9
Version 1.0.7


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
