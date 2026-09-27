# KLAS v1.5.4 release notes

- Term Grades now has a Grading Sheet button below each corresponding Term Class Record icon. Record pages no longer contain the record/sheet switch. Existing GS export and preview actions remain on the Grading Sheet page.
- Removed Final Grades from Class Overview; it remains on Term Grades.
- Removed the Class Records (SF10) tile from Advisory Overview. Teaching Class Records remain in the teaching workspace.
- Adviser Summary now offers explicit teaching-class selection for each subject. Linked subject grades are read live from computed Class Record results, including in SF9. Unlinked subjects retain manual entry/import.
- Linked teaching classes carry a bold (Advisory Class) label in the subject-class dropdown. Native dropdown option font rendering may vary; the label is always included.
- SF1 learner identity remains independent. Matching uses a unique LRN where available, otherwise a unique normalized name; conflicting LRN/sex and ambiguous matches stay blank. The selector reports unmatched learners. Missing/deleted source classes also produce blanks instead of stale grades.
- Linked subject cells cannot be edited/imported over. Saved manual grades remain intact and become visible again if the link is removed. Links persist with the adviser metadata and backups.

Unsigned cumulative payload supplied with the local signing script. No installation, commit or push performed. Grading formulas/transmutation unchanged.
