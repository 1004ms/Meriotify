<h1 align="center">Meriotify</h1>
<p align="center"><b>Spotify, your way.</b></p>

Meriotify is a Spicetify-based Spotify customization fork with its own Hub, UI layer and installer.

**No AI features.**

## Install

Open PowerShell normally:

```powershell
irm https://github.com/1004ms/Meriotify/releases/latest/download/install.ps1 | iex
```

Choose your language. Meriotify, its Hub and Marketplace are configured automatically.

## Meriotify 1.3

- **Spotify+** — one toggle for the full Meriotify UI: live artwork, artwork-derived colors, premium motion and the three-block player.
- **Shuffle+** — true Fisher-Yates shuffle from the normal Spotify Shuffle button.
- **Artwork Theme** — optional cover-based coloring without enabling the full Spotify+ UI.
- **Custom Background**
- **Sleep Timer**
- **Fade Out**
- **Volume+**
- **Keybinds**

All optional Meriotify modules are **OFF by default**.

### Shuffle+ note

For playlist-only playback, disable Spotify's automatic similar-song playback and Smart Shuffle recommendations. Then enable Shuffle+ in Meriotify Hub and press Spotify's normal Shuffle button once.

Shuffle+ is intentionally one-shot. Meriotify does not add a playlist repeat loop.

## Update

```powershell
meriotify update
```

## Uninstall

```powershell
irm https://github.com/1004ms/Meriotify/releases/latest/download/uninstall.ps1 | iex
```

## Compatibility

Meriotify keeps the Spicetify compatibility layer required by existing themes, extensions and Marketplace packages.

## License

Meriotify is a modified fork of Spicetify CLI and is distributed under the GNU LGPL v2.1 terms inherited from upstream. See `LICENSE` and `NOTICE.md`.
