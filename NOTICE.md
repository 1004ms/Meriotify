# Meriotify attribution notice

Meriotify is based on and contains modified source code from the Spicetify CLI project.

Upstream project: https://github.com/spicetify/cli
Upstream project name: Spicetify CLI
License: GNU Lesser General Public License v2.1 (LGPL-2.1)

This repository keeps the upstream LICENSE file. Changes made for Meriotify include branding, installer/update behavior, configuration isolation and migration, release packaging, compatibility aliasing, the Meriotify Hub, Spotify+ UI features, and selected robustness/performance improvements.

`Extensions/shuffle+.js` is derived from the upstream Spicetify Shuffle+ extension by khanhas and Tetrax-10. Meriotify keeps the upstream shuffle engine and adds integration for Meriotify's module toggle and Spotify's native Shuffle button.

The `Spicetify` JavaScript runtime namespace and several compatibility-oriented internal names are intentionally retained so existing third-party extensions, themes and Marketplace content continue to work.
