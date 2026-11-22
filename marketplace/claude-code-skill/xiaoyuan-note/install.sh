#!/usr/bin/env bash
# Installer for the xiaoyuanNote Claude Code skill.
#
# Detects OS + arch, downloads or builds the xiaoyuan-note-mcp binary, and registers
# a user-scope `xiaoyuanNote` MCP server pointing at a workspace path the user is
# prompted for (or one passed via $XIAOYUAN_NOTE_WORKSPACE).
#
# User-scope MCP config lives in ~/.claude.json — NOT ~/.claude/mcp.json,
# which Claude Code never reads. We prefer the `claude mcp add` CLI and only
# fall back to patching ~/.claude.json ourselves when it isn't installed.
#
# Idempotent — re-running upgrades the binary and leaves the config alone
# (won't clobber an existing `xiaoyuanNote` MCP entry).
#
# Usage:
#   bash install.sh                    # interactive
#   XIAOYUAN_NOTE_WORKSPACE=/path bash install.sh  # non-interactive
set -euo pipefail

LATEST=https://github.com/zhitongblog/xiaoyuan-note/releases/latest/download
BIN_DIR="${HOME}/.claude/bin"
MCP_JSON="${HOME}/.claude.json"

mkdir -p "$BIN_DIR"

# ---- Resolve target ----
os=$(uname -s)
arch=$(uname -m)
case "$os" in
  Darwin) target=macos ;;
  Linux)
    case "$arch" in
      x86_64) target=linux-x64 ;;
      aarch64|arm64) target=linux-arm64 ;;
      *) echo "Unsupported Linux arch: $arch"; exit 1 ;;
    esac
    ;;
  MINGW*|MSYS*|CYGWIN*)
    case "$arch" in
      x86_64) target=win-x64 ;;
      aarch64) target=win-arm64 ;;
      *) echo "Unsupported Windows arch: $arch"; exit 1 ;;
    esac
    ;;
  *) echo "Unsupported OS: $os"; exit 1 ;;
esac

echo "Target: $target"

# ---- Install binary ----
case "$target" in
  macos)
    # Apple Silicon + Intel: easiest path is cargo. No standalone tarball
    # is published for macOS because the binary already lives inside
    # xiaoyuannote.app.
    if ! command -v cargo >/dev/null 2>&1; then
      cat <<EOF
xiaoyuan-note-mcp on macOS is distributed via cargo. Install Rust:
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

Or download the xiaoyuannote.app from https://xiaoyuannote.app and link the bundled
binary instead:
  ln -s /Applications/xiaoyuannote.app/Contents/MacOS/xiaoyuan-note-mcp "$BIN_DIR/xiaoyuan-note-mcp"
EOF
      exit 1
    fi
    cargo install xiaoyuan-note-mcp --root "$HOME/.claude"  # installs to $HOME/.claude/bin
    ;;
  linux-x64|linux-arm64)
    url="$LATEST/xiaoyuan-note-mcp-$target.tar.gz"
    echo "Downloading $url"
    curl -L "$url" | tar -xz -C "$BIN_DIR"
    chmod +x "$BIN_DIR/xiaoyuan-note-mcp"
    ;;
  win-x64|win-arm64)
    url="$LATEST/xiaoyuan-note-mcp-$target.zip"
    echo "Downloading $url"
    tmp=$(mktemp -d)
    curl -L "$url" -o "$tmp/xiaoyuan-note-mcp.zip"
    unzip -o "$tmp/xiaoyuan-note-mcp.zip" -d "$BIN_DIR"
    rm -rf "$tmp"
    ;;
esac

if ! [ -x "$BIN_DIR/xiaoyuan-note-mcp" ] && ! command -v xiaoyuan-note-mcp >/dev/null 2>&1; then
  echo "Install completed but xiaoyuan-note-mcp not found on PATH or in $BIN_DIR. Aborting." >&2
  exit 2
fi

echo "Installed: $($BIN_DIR/xiaoyuan-note-mcp --version 2>/dev/null || command -v xiaoyuan-note-mcp)"

# ---- Resolve workspace ----
if [ -z "${XIAOYUAN_NOTE_WORKSPACE:-}" ]; then
  read -rp "Path to your Markdown notes folder: " XIAOYUAN_NOTE_WORKSPACE
fi
if [ ! -d "$XIAOYUAN_NOTE_WORKSPACE" ]; then
  echo "Not a directory: $XIAOYUAN_NOTE_WORKSPACE" >&2
  exit 3
fi
XIAOYUAN_NOTE_WORKSPACE=$(cd "$XIAOYUAN_NOTE_WORKSPACE" && pwd)
echo "Workspace: $XIAOYUAN_NOTE_WORKSPACE"

# ---- Register the server (user scope) ----
# Preferred: let Claude Code write its own config. `claude mcp get` exits
# non-zero when the server isn't registered yet, which makes this idempotent.
registered=0
if command -v claude >/dev/null 2>&1; then
  if claude mcp get xiaoyuanNote >/dev/null 2>&1; then
    echo "Existing 'xiaoyuanNote' MCP server kept — run 'claude mcp remove xiaoyuanNote -s user' to redo it."
    registered=1
  elif claude mcp add --scope user xiaoyuanNote -- \
        "$BIN_DIR/xiaoyuan-note-mcp" --workspace "$XIAOYUAN_NOTE_WORKSPACE"; then
    registered=1
  else
    echo "'claude mcp add' failed — falling back to patching $MCP_JSON." >&2
  fi
fi

if [ "$registered" -eq 0 ]; then
  # Fallback for boxes without the `claude` CLI. Same file Claude Code reads
  # for user scope; back it up first because it also holds unrelated state.
  if [ ! -f "$MCP_JSON" ]; then
    echo '{"mcpServers":{}}' > "$MCP_JSON"
  else
    cp "$MCP_JSON" "$MCP_JSON.bak.$(date +%s)"
  fi

  # Use Python because every macOS / Linux box has it; avoids a jq dep.
  python3 - "$MCP_JSON" "$BIN_DIR/xiaoyuan-note-mcp" "$XIAOYUAN_NOTE_WORKSPACE" <<'PY'
import json, sys, pathlib
path, bin_, ws = sys.argv[1], sys.argv[2], sys.argv[3]
p = pathlib.Path(path)
cfg = json.loads(p.read_text())
servers = cfg.setdefault("mcpServers", {})
if "xiaoyuanNote" in servers:
    print(f"Existing 'xiaoyuanNote' entry kept — edit {path} by hand to change it.")
else:
    servers["xiaoyuanNote"] = {
        "type": "stdio",
        "command": bin_,
        "args": ["--workspace", ws]
    }
    p.write_text(json.dumps(cfg, indent=2) + "\n")
    print(f"Added 'xiaoyuanNote' MCP entry to {path}")
PY
fi

cat <<EOF

Done. Start a new Claude Code session in any folder and run \`/mcp\`. You
should see "xiaoyuanNote" with 16 tools (15 by default).

To enable writes (write_note / append_to_note / autogit_rollback), re-register
with --allow-write:
  claude mcp remove xiaoyuanNote -s user
  claude mcp add --scope user xiaoyuanNote -- $BIN_DIR/xiaoyuan-note-mcp --workspace $XIAOYUAN_NOTE_WORKSPACE --allow-write

Pair with the xiaoyuanNote desktop app for the Agent panel UI:
  https://github.com/zhitongblog/xiaoyuan-note/releases/latest
EOF
