# KLAS v1.4.16

Removed the Subject Teacher Summary of Grades screen and navigation links. Legacy summary routes redirect to Final Grades. Final Grades, per-term Grading Sheet views, and Adviser Summary of Subject Grades remain. No data or calculation changes.

Validation: syntax and browser regression suite passed (fixture loading, grading comparisons, persistence, item editing, responsive layouts). Navigation checks confirm removal and legacy redirect; Adviser summary remains accessible for an imported SF1 workspace. Electron startup/export were not repeated. No signing key accessed or signed updater created.

Payload: app/app.js, app/index.html, main-extension.js. Sign locally using Sign-KLAS-v1.4.16.ps1.
