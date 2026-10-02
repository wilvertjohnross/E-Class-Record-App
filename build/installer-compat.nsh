; KLAS v1.7.0 installer compatibility contract
; Keep installer identity stable across the E-Class Record -> KLAS rename.
!define KLAS_LEGACY_APP_ID "ph.edu.eclassrecord.gs.sf9"

!macro customInit
  ; Academic data migration is intentionally NOT performed by NSIS.
  ; main.js provides non-destructive legacy read-through and writes the new
  ; canonical KLAS data file only after a successful application save.
!macroend
