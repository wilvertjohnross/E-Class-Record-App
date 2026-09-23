# KLAS v1.4.22 — subtle UI effects

Added 160ms navigation fades, brief button color/press transitions, hover outlines on action cards, keyboard-focus outlines and sidebar arrow transitions. Same-screen edits do not replay the fade. Reduced-motion preferences and print media disable animations/transitions; reduced-motion also removes button movement. No grading, persistence, import or export logic changed.

Validation: JavaScript syntax and browser checks passed for navigation-only animation, input focus, reduced-motion, print exclusions, New Class dialog and absence of JS errors. Actual printing and Electron startup were not repeated for this UI-only change. No signed updater generated or private key accessed.

Payload retains app/app.js, app/index.html, flex-importers.js, main-extension.js and templates/SF1 official Template.xls. Sign locally with Sign-KLAS-v1.4.22.ps1.
