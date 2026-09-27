# KLAS v1.5.8 release notes

- Adopted the official teal-and-gold shield/book/sun logo with the KLAS wordmark below the book and no tagline. Updated welcome/sidebar branding and Windows app icon, including multiple ICO sizes.
- Built a complete Windows x64 NSIS installer for colleague evaluation. Includes the full v1.5.7 feature set and all subject artwork/templates; no earlier installation is required.
- Distributed installations use the current user's Downloads directory for local update discovery, removing the developer-specific folder override.
- Blank personal checked/approved signatory defaults for new classes. Existing stored class metadata is untouched.
- Preserve the app identity and storage paths. Installer shortcut is KLAS.

Installer SHA256: 888510ad125c4f33c4d6b3945e490bfdcbeaff340068f8e06e1d346e9d88eba6

The installer is not Windows publisher-signed. No installer wizard was run on this computer. The packaged app archive was launched through an isolated Electron test harness with empty Documents, Downloads and profile directories.

Earlier release notes remain historical records; their references to unsigned update payloads describe the state when those reports were written. Separate v1.5.1–v1.5.7 signing actions do not imply Windows executable publisher signing.
