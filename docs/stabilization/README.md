# Stabilization checkpoint — not a release

This branch preserves the fixes developed against KLAS v1.4.31. It is deliberately based on commit `402e710`, not the newer v1.5.0 redesign on main (`3d6c91188e541b25961119254cff99c0cf232925` when checked on 2026-09-24).

The working version strings say 1.4.32 because that was the originally requested target. They do **not** denote a published release. Main already contains release notes for 1.4.32 through 1.4.37 and 1.5.0. Do not overwrite main with this branch, tag it as a new 1.4.32 release, or install it over v1.5.0. Reconcile each fix against the newer implementation before selecting the next release version.

## Source identity

Authoritative input: `KLAS-v1.4.31-source.zip`, SHA256 `A1605C7FCC197F58520FFBBB0BC9F16025393C5A709B67C0AC1B61A045DC1E3A`.
Its 68 files match commit 402e710 after normalizing Git checkout line endings. Binary files match exactly. The original [read-only audit](v1.4.31-audit.md) is retained as historical evidence; its statement that no fixes were implemented describes the audit stage, not this branch.

## Implemented work

- Detached shared backup validation in `app/state-validation.js`; transactional renderer imports with pre-import recovery and rollback on save failure.
- Bootstrap-compatible extension handlers in `state-persistence.js` for save/load and backup import/export, preserving trusted-window checks. Writes validate and verify a temporary file before replacement, retain previous/dedicated pre-import copies, and preserve unreadable originals.
- ECR import preserves missing HPS, distinguishes explicit zero, rejects invalid scores transactionally, validates all terms, and requires confirmation for valid shared-HPS/weight changes affecting other terms.
- SF1 import validates the final roster before committing metadata or learners, applies replacement before checking final capacity, and rejects invalid/duplicate identities without partial changes.
- Final descriptors use the final grade directly. Numeric grading, averaging, transmutation tables and rounding are unchanged.
- Legacy-only repair controls preserve nonstandard WW/PT setups and custom weighting. Scored items, including zero scores, cannot be removed. New/default classes retain fixed 5/3 controls. No automatic conversion or truncation is provided.
- Simple examination mode is carried into official payload validation and proportional component values in ECR/GS exports.
- Compact SF1 header detection, honest browser save-failure status, retirement of the hidden skip-Welcome preference, and updated navigation guidance.

## Executed validation

`tests/stabilization.cjs` passed all 24 grouped checks in headless Microsoft Edge with synthetic data. This includes transactional ECR/SF1 failures, backup rollback, descriptor correction, legacy repair controls, simple EX values in generated ECR/GS workbook XML, disposable disk-write failures, recovery copies, and trusted-sender enforcement for save/load.

Additional local regression harnesses passed: 240 simple/custom grading vectors against v1.4.31 and again against a synthetic v1.4.8 fixture; numeric term/final comparisons; table endpoints; class create/duplicate/delete/select; nested navigation; fixed 5/3 controls; HPS persistence and validation; examination controls; adviser gateway and SF9 domain separation; welcome/profile popup, clock, photo and Employee ID persistence; themes, reduced motion, and responsive widths from 320 to 1920 pixels. These auxiliary harnesses were run locally and are not all bundled here.

The earlier v1.4.31 signed package was verified with the installed public key, including rejection of a modified manifest. No new package was signed. The installed v1.1.5 bootstrap's main.js, preload.js, thread-updater.js and original templates were compared with the baseline. No private signing material was accessed.

To run the included focused suite, make `playwright` and `adm-zip` available to Node (for example in an external test environment through NODE_PATH), install Microsoft Edge, and run `node tests/stabilization.cjs`. The test uses disposable browser state and temporary files, not the installed app's records. It leaves its temporary disk fixture for inspection.

## Remaining integration and release work

1. Compare and port only still-needed fixes to v1.5.0; retain its redesign and subsequent features. Run the regression suite against that combined result.
2. The update-directory startup scan still happens before the extension overrides the Downloads path. A closed-app update in the configured outputs directory may need another restart after staging. Fixing the initial scan requires a verified bootstrap change; this branch does not claim to fix it.
3. A future cumulative payload must include all prior nine runtime files **plus** `app/state-validation.js` and `state-persistence.js`. The latter is also included in the full-installer build list.
4. Test actual signed staging/restart, native file dialogs and disk-denied recovery on a disposable Windows profile. Test real Excel SF1/ECR/GS/SF2 previews and pagination, SF9 logos/signatories/printing, and display scaling at 100/125/150 percent. Headless/XML checks do not establish these results.
5. Final source/payload archives, signing instructions, release notes and checksums remain unprepared pending the target-baseline decision. No installer or update was installed. No release tag was created.

This checkpoint documents work in progress; it is not evidence that v1.5.0 already contains these fixes or that a release has passed Windows hands-on checks.
