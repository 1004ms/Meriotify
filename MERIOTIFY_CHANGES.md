# Meriotify changes

## 1.1.0

- New bilingual Windows installer with Italian and English selection.
- New complete-install mode: CLI, Marketplace and Spotify setup in one flow.
- Marketplace is installed directly through Meriotify instead of invoking the legacy CLI installer.
- Installer and uninstaller are attached to every GitHub release.
- Added `meriotify init` as an alias for `meriotify setup`.
- Cleaner command help and terminal status prefixes.
- New Meriotify dark/magenta default color scheme for fresh installs.
- Preprocessing avoids redundant per-file stat calls while patching Spotify assets.
- Public update setting renamed to `check_meriotify_update`; existing configs migrate automatically.
- README and release-facing copy rewritten around Meriotify instead of the fork history.

## 1.0.0

- First public Meriotify release.
- Dedicated Meriotify command and data directory.
- Separate Meriotify version and compatibility baseline.
- `meriotify setup` for first-run backup, preprocessing and apply.
- Cached release checks and lean release binaries.
- Safer unzip/copy paths and file-handle cleanup.
