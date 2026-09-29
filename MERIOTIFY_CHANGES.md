# Meriotify changes

## 1.1.5

- Fixed `meriotify update` failing with a temporary GitHub 404 while a new release is still uploading its assets.
- The updater now resolves the real asset URL from the GitHub release metadata instead of assuming the file is already available.
- Added bounded retries for release-asset publication and temporary HTTP 404/429/5xx responses.
- Failed downloads are cleaned up and no longer leave a partial archive behind.
- Update errors return cleanly instead of terminating with a fatal error for transient release-publication failures.
- Preserved the installer-selected Italian/English language across self-updates.

## 1.1.4

- Fixed the Meriotify Marketplace sidebar icon disappearing.
- Marketplace branding now patches the manifest Spotify actually reads.
- `meriotify update` now uses the language selected during installation.
- The selected language is persisted independently from the current PowerShell session.

## 1.1.3

- New Meriotify Marketplace icon and visible branding.
- Fixed Spotify keeping the previous Meriotify version after an update.
- Existing backups are reprocessed automatically when Meriotify changes version.
- Installer errors no longer close the PowerShell window before they can be read.
- Cleaner self-update refresh flow.

## 1.1.2

- Cleaner install, update and uninstall flow.
- Fixed reinstalling over an already customized Spotify install.
- Fixed stale update notifications.
- Cleaner Windows terminal output.
- Installer now runs the full Meriotify + Marketplace setup automatically.

## 1.1.1

- Fixed Windows PowerShell 5.1 installer encoding.

## 1.1.0

- Added Italian and English installer languages.
- Added Marketplace to the main installer.
- Added the Meriotify default theme.
- Added release installer and uninstaller scripts.

## 1.0.0

- First Meriotify release.
