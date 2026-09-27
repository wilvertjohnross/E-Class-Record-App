# KLAS v1.5.3 validation

Baseline: v1.5.2 source, copied into a separate working folder. Only synthetic learner data was used.

## Executed

- Reproduced the original defect: main computed overflow-y:auto while the root document also overflowed. Its decorative background exceeded its bounds, creating the second scroll area.
- tests/page-scroll.cjs passed at 1424, 980 and 390 pixel widths across roster, setup, all three term records, final grades, Term Grades and welcome. Verified main cannot scroll independently, desktop sidebar remains stationary within subpixel tolerance, and learner 45 can be brought fully into view.
- Confirmed Subject Teacher roster has only #, Learner Name, Sex and Remove headings; no LRN/age inputs. Previously stored synthetic LRN and age survived name editing and reload.
- Dark theme check and renderer error checks passed. Browser screenshot reviewed.
- tests/sidebar-class-switching.cjs passed after the scroll change, covering class selection, route retention, adviser separation, sidebar identity, fixed examination controls and safe examination import rejection.
- Packaging checks compare grading/transmutation source sections and bootstrap/updater/signing-helper files with v1.5.2; verify JavaScript syntax, source/payload byte parity, version, 20 runtime files and exclusion of private keys/build dependencies.

## Inspection and remaining checks

Adviser form code is unchanged. No grading formula changes. Native Electron scrolling/Windows scaling, physical printing and installed-app update activation were not executed. The current package is unsigned and no signature is claimed. Existing bootstrap requirements and startup folder-scan limitation remain unchanged.

Hands-on: install the signed patch, confirm v1.5.3, open a long roster and scroll to its last learner; confirm one right-hand page scrollbar and stable sidebar. Check the subject roster lacks LRN/Age while the adviser forms retain their data. Preview/print a long official form in the actual Windows/Excel environment.
