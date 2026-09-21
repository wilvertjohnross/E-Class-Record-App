# KLAS v1.4.12 — action-button colors

Removed ten inline pale-background overrides from roster, SF1 printing, Class Record import/export/printing, Adviser template download and SF9 preview/printing buttons. Secondary action buttons now use the theme's standard accent fill and readable text, including hover and disabled states. Inactive Class Record view-toggle text now uses the normal text color. Existing destructive buttons retain their danger color.

No event handlers, grading calculations, persistence logic or update-folder behavior changed. The v1.4.11 runtime extension is included unchanged to preserve outputs-folder scanning. Payload: app/app.js, app/index.html, main-extension.js. Source package version: 1.4.12.

Validation passed: JavaScript syntax; 100 enabled visible main-content button instances across 16 routes in light/dark themes met 4.5:1 text contrast in the tested fixture; no renderer JavaScript errors. Roster Paste names opens its dialog; hover styling applies; unavailable SF1 print remains disabled in both themes. Roster screenshots visually inspected in both themes. The existing fixture loading, grading comparison, persistence, legacy custom-weight preservation, add/remove and responsive overflow suite also passed. Not every modal or data-dependent state was opened. This color-only patch was browser-tested; Electron startup was previously verified for v1.4.11 and was not repeated. No signed updater was generated or installed and no private key was accessed.

Sign locally using Sign-KLAS-v1.4.12.ps1. Output is KLAS-v1.4.12.ecrupdate beside the script. If v1.4.11 is active, keep KLAS open to detect the signed file in outputs, then restart when staged. Otherwise select it using Help > Install Local Update File... and restart.
