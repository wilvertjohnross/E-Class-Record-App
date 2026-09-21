# KLAS v1.4.13 — sidebar organization

Moved New Class, Duplicate Class and Delete Class below the subject-class selector. Delete retains its danger color, tooltip, confirmation, and extra spacing. Removed the duplicate class-management row from Class Overview. Moved theme and backup controls below navigation, at the sidebar bottom. Desktop sidebar scrolls on short windows; narrow layouts remain in normal document flow. Subject-class actions hide together with the selector in Adviser views.

Existing control IDs and handlers retained. No grading, persistence, backup or deletion logic changed. v1.4.11 update-folder extension remains unchanged and included. Payload: app/app.js, app/index.html, main-extension.js.

Validation: JavaScript syntax passed; browser checks passed for unique control placement, New Class dialog opening, duplication, deletion cancellation, theme switching, Adviser scope, and no horizontal overflow at 1440x900, 980x680, 980x400 and 390x700. Expanded sidebar navigation and scrolled to backup controls. Desktop screenshot visually inspected. No renderer JavaScript errors. Electron and actual backup file round trips were not repeated for this layout-only patch. No private key accessed and no signed updater created.

Run Sign-KLAS-v1.4.13.ps1 locally to produce KLAS-v1.4.13.ecrupdate in outputs. Keep KLAS open to detect it, then restart after staging, or select it through Help > Install Local Update File....
