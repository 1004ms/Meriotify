# Meriotify changes from upstream

This first Meriotify pass intentionally focuses on a stable fork foundation rather than risky rewrites of Spotify patching logic.

## Branding and UX

- Primary executable/command: `meriotify` / `meriotify.exe`.
- Magenta `◆ MERIOTIFY` terminal signature.
- User-facing CLI/update text rebranded to Meriotify.
- Default bundled theme folder renamed to `MeriotifyDefault`.
- PowerShell installer rewritten around a single non-admin core-install flow.
- Added `meriotify setup` for first-time backup + preprocess + apply in one command.
- Marketplace is attempted automatically; set `MERIOTIFY_SKIP_MARKETPLACE=1` to skip it.
- `spicetify.cmd` compatibility shim forwards legacy tooling to `meriotify.exe`.

## Isolation and migration

- Default user configuration/state directory uses `meriotify` rather than `spicetify`.
- Supports `MERIOTIFY_CONFIG` and `MERIOTIFY_STATE` overrides.
- Existing Spicetify config is copied into Meriotify on first run when Meriotify has no config yet.
- The upstream config is not deleted, so both CLIs can coexist.

## Compatibility

- The browser runtime keeps `window.Spicetify` because Marketplace/extensions depend on it.
- `window.Meriotify` is an alias to the same object.
- Compatibility-sensitive names such as `spicetifyWrapper.js`, `spicetify-config.json`, route identifiers and `check_spicetify_update` are intentionally retained.
- Upstream compatibility metadata/CSS-map endpoints remain available where they are tied to Spicetify's Spotify patch knowledge.
- Meriotify release versioning is separated from the upstream compatibility baseline; `meriotify --compat-version` displays that baseline.

## Robustness/performance

- Release builds use `-trimpath`, `-buildvcs=false`, and stripped symbols (`-s -w`).
- GitHub release checks decode responses as a stream, use explicit HTTP timeouts, and cache the latest tag for 12 hours during normal CLI usage.
- Self-update download streams directly to disk with a larger copy buffer.
- Recursive file copies no longer accumulate deferred open handles across a whole directory tree.
- ZIP extraction closes each input/output handle immediately and rejects archive path traversal.
- Removed the upstream AUR/Winget release-trigger job so the fork cannot accidentally update Spicetify-owned distribution infrastructure.

## Owner workflow

- `build.ps1` builds the JS wrapper and produces a Windows release ZIP in `dist/`.
- GitHub Actions produces Meriotify-named release assets automatically on releases matching the configured tag rule.

- Fixed Windows PowerShell 5.1 parsing of helper scripts by making PowerShell UI markers ASCII-safe.
