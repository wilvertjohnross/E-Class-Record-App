E-Class Record App with GS and SF9
Version 1.0.3


SCHOOL LOGO IN v1.0.3
Setup now includes Upload / Change School Logo. The selected school logo is a
global app setting and is automatically shown on the Class Record, Grading
Sheet, and SF9 for every class. PNG, JPG/JPEG, and WebP are supported. PNG is
recommended for transparent-background school logos. Use Reset to Default to
restore the logo bundled with the app. The DepEd seal and wordmark stay fixed.

NEW CLASS FIX IN v1.0.2
The + New Class button now uses an in-app dialog instead of window.prompt().
This fixes the issue where clicking + New Class appeared to do nothing in the
standalone Electron app. Roster > Paste names was updated to use the same
desktop-safe dialog because it relied on the same unsupported prompt mechanism.

PRINTING FIX IN v1.0.1
The in-app Print buttons now use Electron's native Windows printing API instead
of Chromium's unsupported browser print-preview screen. This applies to:
- Class Record / Grading Sheet: Print this view
- SF9: Print this learner
- SF9: Print all learners

WINDOWS BUILD
1. Install Node.js LTS on a Windows computer.
2. Double-click BUILD_WINDOWS.bat.
3. The script installs the required build dependencies.
4. It builds the Windows installer.
5. The completed installer is placed in and opens the dist folder.

Manual build commands:
  npm install
  npm run dist

RUN FOR TESTING
  npm install
  npm start

DESKTOP DATA
The installed application automatically stores its working data under:
Documents\E-Class Record App with GS and SF9\eclass-record-data.json

Automatic daily backups are stored under:
Documents\E-Class Record App with GS and SF9\Backups\

Upgrading or uninstalling the program does not delete the gradebook data folder.


VERSION 1.0.4 — IMPORT SCORES FROM CSV
---------------------------------------
Open Term 1, Term 2, or Term 3 and click "Import Scores CSV".

Recommended CSV layout:
Name,LRN,WW1,WW2,WW3,WW4,WW5,PT1,PT2,PT3,ST1,ST2,TE
"Dela Cruz, Juan",123456789012,45,27,29,50,28,48,46,50,22,23,44

The column names do not have to be exactly the same. The import screen attempts to map common headers automatically and lets you correct each mapping before import.

Important: the CSV values should be RAW SCORES, not percentage scores or transmuted grades. Make sure the component names and Highest Possible Scores (HPS) configured in Setup match the source Excel class record. Existing scores are preserved unless you explicitly enable overwrite.
