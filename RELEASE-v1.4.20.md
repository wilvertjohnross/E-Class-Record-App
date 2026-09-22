# KLAS v1.4.20 — SF1 fit to page width

SF1 generated workbook/PDF now uses landscape, Zoom=false, FitToPagesWide=1 and FitToPagesTall=false. All columns fit across one page; learner rows and footer may continue vertically. Updated the SF1 preview cache signature to regenerate prior previews. Official template and data/grading logic unchanged.

Validation: actual isolated Electron/Excel rendering with 33 synthetic learners succeeded uncached. Generated PDF has three vertically continuing pages; all three were rendered and visually inspected, with the rightmost Learning Modality and Remarks columns on the same page width as learner columns. No actual printing or signed installation performed. No private key accessed.

Payload retains app/app.js, app/index.html, flex-importers.js, main-extension.js and templates/SF1 official Template.xls. Sign locally with Sign-KLAS-v1.4.20.ps1.
