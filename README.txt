E-Class Record App with GS and SF9
Version 1.0.5


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

VERSION 1.0.4 — IMPORT SCORES FROM CSV
Open Term 1, Term 2, or Term 3 and click "Import Scores CSV". CSV values should
be RAW SCORES. The mapping screen can match different CSV column headings to the
app's WW/PT/EXAM components.

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
