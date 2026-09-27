# KLAS v1.5.6 release notes

- Restored SF10 — Learner Permanent Record in Advisory Overview. The existing SF10 page is still a placeholder; this release does not implement the official SF10 form.
- Replaced manual adviser subject/class selectors with automatic Class Record detection and visible per-subject matching status.
- Detection requires matching subject, school year and grade. Conflicting school IDs or sections are rejected. A matching section requires at least one uniquely matched SF1 learner; when section details are absent, every SF1 learner must match uniquely. Multiple eligible records are flagged instead of selected.
- Adviser Summary is read-only. Matching computed grades flow into Summary and SF9 without re-entry. Missing or ambiguous learner matches in a detected class stay blank.
- Subjects without a detected Class Record retain previously saved/imported grades and the grade-import workflow. Ambiguous Class Records stay blank. Existing manual grade data and legacy explicit-link settings are preserved; the old link settings no longer drive selection.
- Includes the v1.5.5 centered Class Overview cards, existing Class Adviser display and learner counts.

No grading formula changes. No installation, commit or push performed.
