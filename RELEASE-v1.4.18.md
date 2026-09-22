# KLAS v1.4.18 — SF1 preview compatibility

Routes SF1 preview/print through the installed bootstrap's existing ecr:official-pdf-preview action, with an explicit documentType=sf1 discriminator and boolean autoPrint. The runtime extension dispatches only that discriminator to the existing SF1 handler. Ordinary ECR preview remains unchanged. The bootstrap's trusted-sender check, payload size limit and allowlist are unchanged, and SF1 validation still runs. Existing dedicated SF1 aliases are retained for compatible hosts.

Full Excel testing also exposed partial merged-cell clearing in the SF1 template writer. Empty values now clear the whole merged area while nonempty values continue to write to its first cell. The official template itself, grading and data schema are unchanged.

Validation: isolated Electron test with original main/preload reproduced rejection of the old SF1 action, then confirmed the compatible action reached SF1 validation. A synthetic learner was rendered through actual Microsoft Excel into new XLS and PDF files and opened in an in-app SF1 preview window (cached=false, ok=true). No printing was triggered. Stubbed-renderer dispatch test separately confirmed autoPrint=true forwarding and unchanged ordinary ECR routing. This was not the user's workbook or a signed installation test. Private key was not accessed.

Payload: app/app.js, app/index.html, flex-importers.js, main-extension.js. Includes all previous changes. Sign locally with Sign-KLAS-v1.4.18.ps1 and restart after staging, then retry Preview Official SF1. Actual printer output was not tested.
