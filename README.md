# â—† Meriotify

**Meriotify** is a streamlined, rebranded fork of the Spicetify CLI for customizing the desktop Spotify client on Windows, macOS and Linux.

The goal of this fork is simple: keep Spicetify's ecosystem compatibility while making the CLI easier to install, cleaner to use and leaner to ship.

## What changes

- `meriotify` is the primary command and executable.
- User configuration lives in a separate `meriotify` folder, so it can coexist with Spicetify.
- Existing Spicetify configuration is imported on first run when possible; the original files are not deleted.
- The injected `Spicetify` JavaScript API is intentionally preserved for extension/theme compatibility and is also exposed as `Meriotify`.
- The core PowerShell installation is non-interactive and verifies the installed executable; Marketplace may still ask before replacing an existing local theme.
- Release binaries use `-trimpath` and stripped debug symbols to reduce package size.
- Update networking uses explicit timeouts, streaming downloads and a 12-hour release-check cache so normal commands do not wait on GitHub every launch.
- File-copy/unzip paths close handles immediately and the unzip routine rejects path traversal entries.

## Windows install

Once this repository is published as `1004ms/Meriotify`, install from a normal **PowerShell** window:

```powershell
iwr -useb https://raw.githubusercontent.com/1004ms/Meriotify/main/install.ps1 | iex
```

The installer downloads the newest release, adds Meriotify to your user `PATH`, installs a compatibility shim for tooling that still invokes `spicetify`, and attempts to install Spicetify Marketplace.

To skip Marketplace for one installation:

```powershell
$env:MERIOTIFY_SKIP_MARKETPLACE='1'; iwr -useb https://raw.githubusercontent.com/1004ms/Meriotify/main/install.ps1 | iex
```

If you publish the fork under a different GitHub account/repository, run `./configure-repo.ps1 -Repository "owner/Meriotify"` once before the first release. It updates the Go module/imports and Meriotify update/install endpoints consistently. You can also override the repository at install/runtime with `MERIOTIFY_REPOSITORY=owner/repo`.

## First run

```powershell
meriotify setup
```

Useful commands:

```powershell
meriotify -h
meriotify --compat-version
meriotify config-dir
meriotify update
meriotify restore
```

## Compatibility

Meriotify deliberately keeps internal identifiers such as the `Spicetify` browser API, `spicetify-config.json`, `spicetifyWrapper.js`, route module names and the existing `check_spicetify_update` config key where changing them would break themes, extensions, Marketplace packages or upstream compatibility.

## Build

Releases are built by GitHub Actions. The workflow builds the JavaScript wrapper, then compiles the Go CLI with size-oriented release flags and creates platform archives named `meriotify-<version>-<platform>-<arch>`.

For Windows owner builds you can simply run `./build.ps1 -Version 1.0.0`; it creates the release ZIP under `dist/`. The source requires the Go version specified by `go.mod` and pnpm/Node versions used by the workflow.

## License and upstream

Meriotify is a modified fork of [Spicetify CLI](https://github.com/spicetify/cli). The original project is licensed under **GNU LGPL v2.1**. This fork retains the upstream `LICENSE` and the notices required for redistribution. Meriotify is not the original Spicetify project.
