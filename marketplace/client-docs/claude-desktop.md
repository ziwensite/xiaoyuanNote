# `xiaoyuan-note-mcp` in Claude Desktop

## Install the server

Pick one path:

### Path A — bundled in xiaoyuannote.app (recommended)

Install [xiaoyuanNote](https://xiaoyuannote.app) and the MCP server ships inside the
app bundle. Then in xiaoyuan-note: `Settings → Integrations → Print MCP config`
copies the right JSON snippet for Claude Desktop.

### Path B — standalone binary

1. Download from the
   [latest release](https://github.com/zhitongblog/xiaoyuan-note/releases/latest):
   - macOS arm64/x64: `cargo install xiaoyuan-note-mcp` (or grab the bundled
     binary from xiaoyuannote.app)
   - Linux x64: `xiaoyuan-note-mcp-linux-x64.tar.gz`
   - Linux arm64: `xiaoyuan-note-mcp-linux-arm64.tar.gz`
   - Windows x64: `xiaoyuan-note-mcp-win-x64.zip`
   - Windows arm64: `xiaoyuan-note-mcp-win-arm64.zip`
2. Extract and put `xiaoyuan-note-mcp` on your `PATH` (or remember the absolute
   path for the config below).

## Wire into Claude Desktop

Open Claude Desktop's config:

- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **Linux**: `~/.config/Claude/claude_desktop_config.json`

Add this under `mcpServers`:

```json
{
  "mcpServers": {
    "xiaoyuanNote": {
      "command": "xiaoyuan-note-mcp",
      "args": [
        "--workspace", "/Users/you/notes"
      ]
    }
  }
}
```

Multiple workspaces? Repeat the flag:

```json
{
  "mcpServers": {
    "xiaoyuanNote": {
      "command": "xiaoyuan-note-mcp",
      "args": [
        "--workspace", "work=/Users/you/work-notes",
        "--workspace", "home=/Users/you/diary"
      ]
    }
  }
}
```

Need writes (Claude can create / overwrite notes)? Add `--allow-write`:

```json
"args": [
  "--workspace", "/Users/you/notes",
  "--allow-write"
]
```

Restart Claude Desktop. The 🔌 icon in the bottom of the message box should
show "xiaoyuanNote" with all 16 tools (15 by default).

## Try it

> Use the xiaoyuanNote MCP tools to list every note tagged `#project`, then show me
> the backlinks for the most-recently-modified one.

## About xiaoyuanNote

[**xiaoyuanNote**](https://xiaoyuannote.app) is a free, MIT Markdown + plaintext editor.
Same `.md` files as your favourite plain-text setup; the editor adds a
Wiki-link + backlink graph, semantic search, per-note AutoGit history, a
streamed Agent panel that cites notes with `[[wikilinks]]`, and the same
`xiaoyuan-note-mcp` server you just installed — pre-wired.

You don't need the app to use the MCP server. But if you want the **Agent
panel**, **pending write accept/reject UI**, **AutoGit branch sandbox per
agent run**, and **BYOK keys in the OS keychain** — get the app.

[📥 Download xiaoyuanNote for macOS / Windows / Linux](https://github.com/zhitongblog/xiaoyuan-note/releases/latest)
