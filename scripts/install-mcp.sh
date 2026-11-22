#!/bin/bash
#
# Installs the `xiaoyuan-note-mcp` binary (Model Context Protocol server for a
# xiaoyuanNote vault) to /usr/local/bin (or $HOME/.local/bin if /usr/local/bin
# isn't writable).
#
# Run via:
#   curl -fsSL https://raw.githubusercontent.com/zhitongblog/xiaoyuan-note/main/scripts/install-mcp.sh | bash
#
# Override the version with: VERSION=v2.2.0 curl ... | bash
#
# Mirrors the layout of `scripts/install-cli.sh`. Binaries are released as
# tarballs alongside the desktop app under
#   xiaoyuan-note-mcp-<platform>-<arch>.tar.gz
# at https://github.com/zhitongblog/xiaoyuan-note/releases.

set -e

REPO="zhitongblog/xiaoyuan-note"
VERSION="${VERSION:-latest}"

# ---------------------------------------------------------------------------
# Detect platform / arch
# ---------------------------------------------------------------------------

uname_s="$(uname -s)"
uname_m="$(uname -m)"

case "$uname_s" in
    Darwin)  platform="mac" ;;
    Linux)   platform="linux" ;;
    MINGW*|MSYS*|CYGWIN*) platform="win" ;;
    *)
        echo "Error: unsupported OS: $uname_s" >&2
        echo "Build from source: cargo install --git https://github.com/$REPO xiaoyuan-note-mcp" >&2
        exit 1
        ;;
esac

case "$uname_m" in
    arm64|aarch64)
        if [[ "$platform" == "mac" ]]; then
            arch="universal"
        else
            arch="arm64"
        fi
        ;;
    x86_64|amd64)
        if [[ "$platform" == "mac" ]]; then
            arch="universal"
        else
            arch="x64"
        fi
        ;;
    *)
        echo "Error: unsupported architecture: $uname_m" >&2
        exit 1
        ;;
esac

asset="xiaoyuan-note-mcp-${platform}-${arch}.tar.gz"
if [[ "$platform" == "win" ]]; then
    asset="xiaoyuan-note-mcp-${platform}-${arch}.zip"
fi

# ---------------------------------------------------------------------------
# Resolve download URL
# ---------------------------------------------------------------------------

if [[ "$VERSION" == "latest" ]]; then
    URL="https://github.com/$REPO/releases/latest/download/$asset"
else
    URL="https://github.com/$REPO/releases/download/$VERSION/$asset"
fi

echo "Platform: $platform/$arch"
echo "Asset:    $asset"
echo "URL:      $URL"

# ---------------------------------------------------------------------------
# Pick install dir
# ---------------------------------------------------------------------------

# Honour an explicit install dir (used by CI self-test + advanced setups).
# Otherwise fall back to the standard precedence: /usr/local/bin, then
# ~/.local/bin (the latter requires it to be on PATH).
if [[ -n "${INSTALL_DIR:-}" ]]; then
    mkdir -p "$INSTALL_DIR"
    if [[ ! -w "$INSTALL_DIR" ]]; then
        echo "Error: INSTALL_DIR=$INSTALL_DIR not writable" >&2
        exit 1
    fi
    target_dir="$INSTALL_DIR"
else
    TARGETS=("/usr/local/bin" "$HOME/.local/bin")
    target_dir=""
    for d in "${TARGETS[@]}"; do
        if [[ -w "$d" ]] || (mkdir -p "$d" 2>/dev/null && [[ -w "$d" ]]); then
            target_dir="$d"
            break
        fi
    done
    if [[ -z "$target_dir" ]]; then
        echo "Error: no writable install dir. Tried: ${TARGETS[*]}" >&2
        echo "Run with sudo, or create ~/.local/bin and add it to PATH." >&2
        exit 1
    fi
fi

target_bin="$target_dir/xiaoyuan-note-mcp"
[[ "$platform" == "win" ]] && target_bin="$target_dir/xiaoyuan-note-mcp.exe"

# ---------------------------------------------------------------------------
# Download + extract
# ---------------------------------------------------------------------------

tmp="$(mktemp -d -t xiaoyuan-note-mcp.XXXXXX)"
trap 'rm -rf "$tmp"' EXIT

archive="$tmp/$asset"
# CI/test override: skip the download and use a local tarball. Used by
# .github/workflows/release.yml to verify the just-built tarball without
# round-tripping through the public release URL (which 404s on draft
# releases until the publish flip happens).
if [[ -n "${LOCAL_TARBALL:-}" ]]; then
    echo "Using local tarball: $LOCAL_TARBALL"
    cp "$LOCAL_TARBALL" "$archive"
else
    echo "Downloading..."
    if command -v curl >/dev/null 2>&1; then
        curl -fsSL "$URL" -o "$archive"
    elif command -v wget >/dev/null 2>&1; then
        wget -q "$URL" -O "$archive"
    else
        echo "Error: need curl or wget" >&2
        exit 1
    fi
fi

echo "Extracting..."
case "$asset" in
    *.tar.gz) tar -xzf "$archive" -C "$tmp" ;;
    *.zip)    (cd "$tmp" && unzip -q "$archive") ;;
esac

src_bin="$tmp/xiaoyuan-note-mcp"
[[ "$platform" == "win" ]] && src_bin="$tmp/xiaoyuan-note-mcp.exe"
if [[ ! -f "$src_bin" ]]; then
    # Some release archives may include a top-level dir; find it.
    found="$(find "$tmp" -name 'xiaoyuan-note-mcp' -o -name 'xiaoyuan-note-mcp.exe' | head -1)"
    if [[ -n "$found" ]]; then
        src_bin="$found"
    else
        echo "Error: xiaoyuan-note-mcp binary not found in archive" >&2
        ls -la "$tmp" >&2
        exit 1
    fi
fi

mv "$src_bin" "$target_bin"
chmod +x "$target_bin"

echo "Installed: $target_bin"
echo
echo "Try: xiaoyuan-note-mcp --version"
echo
echo "Next step — register with your MCP client. Example for Claude Code:"
echo '  claude mcp add --scope user xiaoyuan-note-vault -- xiaoyuan-note-mcp --workspace ~/Documents/Notes'
echo
echo "That writes the user-scope config at ~/.claude.json. To scope the server"
echo "to a single project instead, put an .mcp.json in the project root. See:"
echo "  https://github.com/$REPO/tree/main/mcp-server#wire-it-up"
