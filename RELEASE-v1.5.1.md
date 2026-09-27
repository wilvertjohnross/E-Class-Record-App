# KLAS v1.5.1 — Class Record keyboard workflow

Based on v1.5.0 commit `3d6c91188e541b25961119254cff99c0cf232925`. Retains the v1.5.0 design and assets.

- Class Record: Tab/Shift+Tab move to the next/previous editable score box in row order. Enter/Shift+Enter move down/up the same item. Group headings and inactive HPS-zero items are skipped. Enter stays in the final/first row at the boundary; Tab can leave the grid. Invalid entries restore the previous score and retain focus.
- Scores save and calculated cells refresh without replacing the input elements, preserving keyboard and mouse focus.
- Class Setup: WW and PT have add/remove controls with maximums of 5 and 3. New classes still default to 5/3. Fewer items, including an empty category, are permitted. Existing excess legacy items remain intact and cannot be increased. Items with scores in any term, including zero, are protected from deletion. Removing an unscored item from a category with other recorded scores requires confirmation because changing the HPS total can change grades.
- Help → Keyboard Shortcuts → Edit Page Shortcuts opens the shortcut editor. Ctrl+Shift+K also opens it. Assign Ctrl+Shift plus an available letter or digit, clear assignments, or restore defaults. Duplicate/reserved combinations are rejected. Settings persist locally and in backups. Dialogs suspend page shortcuts, and existing adviser access rules remain in force.
- Default shortcuts: Ctrl+Shift+0 Welcome; 1 Class Overview; 2 Class Setup; 3 Learner Roster; 4 Grading; 5/6/7 Term 1/2/3 Class Records; 8 Final Grades; 9 Advisory Overview. SF1, SF2, Adviser Summary, SF9 Setup/Report and each term's Grading Sheet can be assigned in the editor.

No grading formulas, transmutation tables or rounding rules changed. No private signing material is included. The payload is unsigned until the user runs the signing script. No installation, release tag, commit or push was performed for this patch.

The separate v1.4.31 stabilization branch was not merged into this newer baseline. This patch addresses the Class Record and shortcut requests; it does not claim to resolve every remaining issue in that older audit.
