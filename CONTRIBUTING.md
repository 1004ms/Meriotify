# Contributing to Meriotify

Meriotify is a compatibility-focused fork of Spicetify CLI. Changes should keep the existing theme, extension and Marketplace ecosystem working unless a deliberate compatibility break is documented.

## Development setup

Windows owner build:

```powershell
./build.ps1 -Version Dev
```

Manual development requirements are Go 1.25+, Node.js 18+ and Corepack/pnpm. The JavaScript wrapper must be rebuilt after changes under `src/jsHelper/spicetifyWrapper`.

```powershell
corepack pnpm install --frozen-lockfile
corepack pnpm build:wrapper
go build .
```

## Fork rules

- Keep `window.Spicetify` as the compatibility API. `window.Meriotify` may extend or alias it, but existing extensions must not be broken just for naming consistency.
- Keep the upstream LGPL-2.1 license and attribution notice.
- Do not point Meriotify release automation at Spicetify-owned package/release infrastructure.
- Prefer measurable performance/robustness improvements over cosmetic rewrites of patching code.
- When rebasing onto a newer stable Spicetify line, update the Meriotify upstream compatibility baseline used by `build.ps1` and `.github/workflows/build.yml`.

## Upstream issues

If a bug reproduces unchanged on official Spicetify, check the upstream project first: https://github.com/spicetify/cli. Meriotify-specific installer, branding, update, migration or fork regressions belong in the Meriotify repository.
