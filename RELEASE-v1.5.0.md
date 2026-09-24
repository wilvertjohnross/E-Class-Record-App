# KLAS v1.5.0 — Major UI Redesign

## Highlights

- Sidebar is now a passive location rail; KLAS branding returns to Home, while Dark Mode and backup utilities remain available.
- Added deterministic Home and Return navigation across teaching and adviser workflows.
- Rebuilt Welcome, Class Overview, Grading, and Advisory Overview around colorful icon launchers.
- Added quiet page-specific visual atmosphere while keeping tables, forms, and scores dominant and readable.
- Improved responsive launcher behavior and dark-mode treatment.

## Approved visual contract

The final presentation is aligned to the approved UI mockup: a narrow high-level sidebar, top-right Home/Return controls, centered page headings, softly blurred/faded classroom scenery, small translucent launcher tiles, colorful icons, and subtle animated lift/press feedback. Existing approved KLAS banner/logo artwork is retained instead of the generic mockup branding.

## Compatibility

This release is designed to preserve existing v1.4.x local data and the current grading/form logic. No cloud sync, grade locking, audit history, or administrator-account functionality is included.

## Update packaging

The UI redesign reuses existing bundled background/brand assets, so the established cumulative nine-file updater overlay remains sufficient. The updater must still be signed locally with the existing private signing key.
