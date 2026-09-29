<h1 align="center">Meriotify</h1>
<p align="center"><b>Spotify, your way.</b></p>

Meriotify is a fast Spotify customization CLI built for themes, extensions, custom apps and Marketplace without turning setup into a project of its own.

It keeps compatibility where the ecosystem needs it, but the user-facing experience is Meriotify: its own command, data folder, updater, installer and release flow.

## Install on Windows

Open a normal PowerShell window and run:

```powershell
irm https://github.com/1004ms/Meriotify/releases/latest/download/install.ps1 | iex
```

The installer asks for your language and then offers two modes:

- **Complete** — installs Meriotify, Marketplace and configures Spotify for you.
- **Core only** — installs only the CLI so you can configure it later.

For a manual first setup:

```powershell
meriotify setup
```

> Use the desktop Spotify client from spotify.com. The Microsoft Store build is not supported.

## Everyday commands

```powershell
meriotify setup                 # first setup / rebuild
meriotify update                # update Meriotify
meriotify apply                 # apply current customization
meriotify config-dir            # open Meriotify data
meriotify restore               # restore stock Spotify
meriotify -h                    # command overview
```

`meriotify init` is an alias for `meriotify setup`.

## Uninstall

```powershell
irm https://github.com/1004ms/Meriotify/releases/latest/download/uninstall.ps1 | iex
```

The uninstaller can restore Spotify first and can optionally keep your themes, extensions and configuration.

## What Meriotify changes

- Dedicated `%APPDATA%\meriotify` user data on Windows.
- One-command setup instead of remembering a backup/apply sequence.
- Release-aware PowerShell installer with x64, x86 and ARM64 detection.
- Native Marketplace installation through Meriotify rather than a second CLI installer.
- Update checks cached for 12 hours so normal commands do not wait on GitHub every launch.
- Size-oriented release builds (`-trimpath`, stripped debug symbols).
- Safer archive extraction and file handling with immediate handle cleanup.
- Cleaner CLI output and a compact command reference.

## Compatibility

Meriotify intentionally keeps a small compatibility layer for existing themes, extensions and Marketplace packages. Some internal names therefore still use the original API identifiers even though the command and user-facing product are Meriotify.

You can inspect the compatibility baseline with:

```powershell
meriotify --compat-version
```

## Build from source

Releases are built by GitHub Actions. The workflow builds the JavaScript compatibility bundle, compiles the Go CLI and publishes platform archives together with the Windows installer scripts.

For a local Windows release build:

```powershell
.\build.ps1 -Version 1.1.0
```

The required Go version is defined in `go.mod`.

## License

Meriotify is a modified fork of Spicetify CLI and is distributed under the GNU LGPL v2.1 terms inherited from the upstream project. See `LICENSE` and `NOTICE.md` for details.
