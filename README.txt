E-Class Record App with GS and SF9
Version 1.0.1

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
