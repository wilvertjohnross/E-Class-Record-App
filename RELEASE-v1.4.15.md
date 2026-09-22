# KLAS v1.4.15 — Adviser SF1 gateway

Advisory Overview shows an in-page message, "You are currently not an Adviser", with Upload SF1 until an adviser SF1 has been imported. School Forms & Records is hidden while locked; all adviser routes return to the gateway. Successful confirmed import unlocks existing adviser pages. Existing imported workspaces remain unlocked; migrated/unimported workspaces retain their data but require SF1 import for access. No new role or persistence schema added: uses existing adviserSf1Ready and sf1SourceStatus.

The Upload SF1 button uses the existing desktop file picker, preview/confirmation and import path. The entry message is not a popup; existing import dialogs/warnings remain. Subject Teacher classes and scores are unchanged.

Validation: syntax passed; browser integration checks used a mocked desktop importer response with the real import preview/apply/save/render path. All eight adviser routes gated without an entry alert; file cancellation, importer error and preview cancellation remained locked. Confirmed import unlocked adviser navigation, survived reload, and allowed SF9 Setup. Subject class JSON stayed identical. No renderer JS errors. Desktop gateway screenshot inspected. Actual Excel parsing/file selection and Electron startup were not rerun; existing importer is unchanged.

Payload: app/app.js, app/index.html, main-extension.js. Includes all preceding changes and unchanged outputs-folder update extension. Sign locally with Sign-KLAS-v1.4.15.ps1. No private key accessed or signed updater generated.
