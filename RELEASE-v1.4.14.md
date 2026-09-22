# KLAS v1.4.14 — restore Subject Teacher

Restored the Subject Teacher input in Class Setup by excluding it from the UI-removal list; added an associated label. Existing meta.teacher persistence, Class Record TEACHER display and preparedByName-or-teacher signatory fallback are unchanged. Adviser and School Head inputs remain hidden as before.

Validation passed: JavaScript syntax; teacher edited and persisted after reload; teacher shown in all three term records; default Prepared by signatory matches in all three term Grading Sheets; a separate Prepared by name still overrides the fallback without changing the teacher. No renderer JavaScript errors. Class Setup screenshot inspected. Tests used synthetic learner data in a browser. Electron startup and official Excel export were not rerun; underlying mapping/export logic is unchanged.

Payload: app/app.js, app/index.html, main-extension.js. Includes prior sidebar/colors/icons and outputs-folder scanning. No private key accessed or signed updater generated. Sign locally using Sign-KLAS-v1.4.14.ps1 to create KLAS-v1.4.14.ecrupdate. Source package version 1.4.14.
