#!/usr/bin/env sh
# Meriotify installer. Based on the upstream Spicetify installer (LGPL-2.1).
set -eu

repo="${MERIOTIFY_REPOSITORY:-1004ms/Meriotify}"
tag="${MERIOTIFY_VERSION:-}"
install_dir="${MERIOTIFY_INSTALL:-$HOME/.meriotify}"

if [ "$(id -u)" -eq 0 ] && [ "${MERIOTIFY_ALLOW_ROOT:-0}" != "1" ]; then
  echo "Meriotify should not be installed as root. Re-run without sudo." >&2
  exit 1
fi

case "$(uname -sm)" in
  "Darwin x86_64") target="darwin-amd64" ;;
  "Darwin arm64") target="darwin-arm64" ;;
  "Linux x86_64") target="linux-amd64" ;;
  "Linux aarch64") target="linux-arm64" ;;
  *) echo "Unsupported platform: $(uname -sm)" >&2; exit 1 ;;
esac

command -v curl >/dev/null 2>&1 || { echo "curl is required" >&2; exit 1; }
command -v tar >/dev/null 2>&1 || { echo "tar is required" >&2; exit 1; }

if [ -z "$tag" ]; then
  tag=$(curl -fsSL -H 'Accept: application/vnd.github+json' -H 'User-Agent: Meriotify-Installer' \
    "https://api.github.com/repos/$repo/releases/latest" | sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"v\{0,1\}\([^"]*\)".*/\1/p' | head -n1)
fi
[ -n "$tag" ] || { echo "Could not resolve Meriotify version" >&2; exit 1; }

tag=${tag#v}
archive="meriotify-$tag-$target.tar.gz"
url="https://github.com/$repo/releases/download/v$tag/$archive"
tmp="${TMPDIR:-/tmp}/meriotify-$$.tar.gz"

printf '  MERIOTIFY\n\n'
printf '  › Downloading v%s (%s)\n' "$tag" "$target"
curl -fL --progress-bar -o "$tmp" "$url"
mkdir -p "$install_dir"
tar xzf "$tmp" -C "$install_dir"
rm -f "$tmp"
chmod +x "$install_dir/meriotify"
ln -sf "$install_dir/meriotify" "$install_dir/spicetify"

add_path_line="export PATH=\"$install_dir:\$PATH\""
case "${SHELL:-}" in
  *zsh) rc="${ZDOTDIR:-$HOME}/.zshrc" ;;
  *bash) rc="$HOME/.bashrc" ;;
  *fish) rc="$HOME/.config/fish/config.fish"; add_path_line="fish_add_path \"$install_dir\"" ;;
  *) rc="" ;;
esac
if [ -n "$rc" ]; then
  mkdir -p "$(dirname "$rc")"
  touch "$rc"
  grep -F "$install_dir" "$rc" >/dev/null 2>&1 || printf '\n%s\n' "$add_path_line" >> "$rc"
fi

printf '\n  ✓ Meriotify v%s installed in %s\n' "$tag" "$install_dir"
printf '  Run: meriotify setup\n'
