# KLAS v1.4.32

Stabilization patch based on the v1.4.31 regression audit.

- Makes backup replacement and SF1 roster import transactional so failed operations do not leave partial live-state changes.
- Rejects incomplete teaching-class backups before they can replace working data; retires the removed startup-skip preference.
- Preserves existing HPS when imported ECR HPS cells are blank and blocks shared grading-configuration changes that would silently recalculate protected grades in other terms or unmatched learners.
- Corrects Final Grades descriptor selection without changing numeric final grades or the transmutation table.
- Aligns simple/custom Examination handling between the renderer and official ECR/GS output validation.
- Keeps new-class defaults at 5 WW / 3 PT while allowing existing classes to use fewer components within those maximums.
- Treats 5 WW and 3 PT as official-template maximums rather than exact required counts. Fewer WW/PT components export normally with unused template slots left blank; scored legacy extras remain preserved and are blocked from unsafe automatic removal.
- Improves compact SF1 one-row header detection.
- Reports browser-only persistence failures correctly and updates obsolete navigation guidance.

Bootstrap/update-folder scan-order behavior is unchanged in this updater-compatible patch.
