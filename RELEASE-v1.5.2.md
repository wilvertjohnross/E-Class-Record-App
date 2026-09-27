# KLAS v1.5.2 release notes

- Fixed examination setup: ST1, ST2 and Term Exam retain the existing 30/30/40 weighting. Examination structure, mode and weights are no longer customizable. HPS remains editable with existing score safeguards.
- Existing nonstandard examination configurations and scores are preserved and clearly identified. They are not silently converted. ECR imports that change examination weights are rejected before committing data.
- Subject-class selection is available on Class Overview, Class Setup, Learner Roster, Term Grades, each term record and Final Grades. Switching classes keeps the current page. Adviser records remain separate.
- Renamed Grading navigation to Term Grades; Grading Sheet remains unchanged.
- Restored the version at the bottom of the sidebar and added a soft off-white background behind the clickable home banner.
- Preserved v1.5.1 keyboard navigation, editable page shortcuts and WW/PT controls with maximums of 5/3.

The payload is cumulative and UNSIGNED. Run the accompanying local signing script to produce an .ecrupdate using your existing signing workflow. No installation, signing, commit or push was performed.
