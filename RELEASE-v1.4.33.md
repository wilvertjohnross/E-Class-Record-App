# KLAS v1.4.33

Hotfix for official ECR/GS component-count validation after v1.4.32.

- Treats Written Works and Performance Tasks component counts as capacity limits rather than exact requirements.
- Official ECR/GS output accepts 1 to 5 Written Works components and 1 to 3 Performance Tasks components.
- Unused official-template component slots remain blank.
- Counts above 5 WW or above 3 PT remain blocked.
- New-class defaults remain 5 WW / 3 PT.
- No grading formula, category weight, transmutation table, or existing learner score is changed.

This patch uses a new version number because an earlier v1.4.32 package with exact-count validation may already have been staged or installed. Reusing the same version can cause the updater to retain the older staged build.
