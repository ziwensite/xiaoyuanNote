# `xiaoyuan-note-mcp` in Continue.dev

[Continue](https://continue.dev) (VS Code + JetBrains AI assistant) reads
MCP config from `~/.continue/config.json` under the `mcp` key.

## Install the server

```bash
# macOS
cargo install xiaoyuan-note-mcp

# Linux x64
curl -L https://github.com/zhitongblog/xiaoyuan-note/releases/latest/download/xiaoyuan-note-mcp-linux-x64.tar.gz \
  | tar -xz -C /usr/local/bin

# Linux arm64
curl -L https://github.com/zhitongblog/xiaoyuan-note/releases/latest/download/xiaoyuan-note-mcp-linux-arm64.tar.gz \
  | tar -xz -C /usr/local/bin

# Windows — unzip and put on PATH.
```

## Config — `~/.continue/config.json`

```json
{
  "models": [...],
  "mcp": [
    {
      "name": "xiaoyuanNote",
      "command": "xiaoyuan-note-mcp",
      "args": ["--workspace", "/Users/you/notes"]
    }
  ]
}
```

Reload Continue. The MCP block in the sidebar should show `xiaoyuanNote` with
16 tools (15 by default).

## Try it

In Continue chat:

> /xiaoyuanNote search for "TODO" and group by directory.

Or just ask naturally — Continue will figure out which tool to call:

> Show me every note I've written this week and the headings inside them.

## Allow writes

```json
"args": [
  "--workspace", "/Users/you/notes",
  "--allow-write"
]
```

## About xiaoyuanNote

[**xiaoyuanNote**](https://xiaoyuannote.app) is the Markdown editor that ships this MCP
server pre-wired. Get the desktop app for the Agent panel UI, AutoGit
history navigation, and the pending write accept/reject screen:

[📥 Download xiaoyuanNote for macOS / Windows / Linux](https://github.com/zhitongblog/xiaoyuan-note/releases/latest)
