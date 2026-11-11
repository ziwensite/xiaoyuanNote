<!-- SHARED — paste into every market listing. Source of truth for the
     `solomd-mcp` tool inventory. Update here, repaste downstream.
     `mcp-server/tests/release_consistency.rs` checks the count and the
     static inventories against mcp-server/src/tools.rs. -->

## Tools

`solomd-mcp` defines 16 JSON-RPC tools over stdio: 12 read tools and 4 write
tools. All 4 write tools are listed in `tools/list` but fail until the server
is started with `--allow-write`. `export_note` is removed from the router when
its Node export backend is unavailable, so a default install lists 15.

### Read tools (12)

| Tool | What it does |
|---|---|
| `list_notes` | List `.md` files under a workspace (optional `subdir`, `limit`). |
| `read_note` | Return the full contents of one note, plus front matter, headings, tags and outbound wikilinks. |
| `search` | Substring or regex search across the workspace. Returns matches with line numbers. |
| `get_backlinks` | Find every note that contains `[[<name>]]` pointing at a given note. |
| `list_tags` | Aggregate `#tags` across the workspace with occurrence counts. |
| `list_tasks` | Every Markdown checkbox in the workspace, with file, line and done state. |
| `get_outline` | Heading structure of a note (H1–H6 with line numbers). |
| `autogit_log` | Per-note commit history (recent revisions, author/date, commit message). |
| `autogit_diff` | Diff between two revisions of one note (or "current vs N commits ago"). |
| `sync_status` | Current sync state with the upstream git remote (ahead/behind, conflicts, dirty files). |
| `share_url` | Generate a `solomd.app/share/?repo=…&path=…` read-only link for a note in a public GitHub repo. |
| `read_agent_trace` | Replay a previous agent recipe run from its `.solomd/agent-runs/<run-id>/trace.jsonl`. |

### Write tools (4, gated behind `--allow-write`)

| Tool | What it does |
|---|---|
| `write_note` | Create or overwrite a note. Returns the new path and a diff against any prior version. |
| `append_to_note` | Append to an existing note (idempotent — won't duplicate a block already present at the bottom). |
| `autogit_rollback` | Restore a note to a specific past commit. |
| `export_note` | Export a note to html / md / txt / docx. Listed only when the Node export backend is found. |

### Workspace federation

Every tool takes an optional `workspace` argument. Start `solomd-mcp` with
multiple `--workspace` flags to serve more than one vault in a single
session:

```bash
solomd-mcp --workspace work=/Users/me/notes --workspace home=/Users/me/diary
```

Then a tool call with `{"workspace": "home"}` resolves to the right vault.
Without a `workspace` argument the first one registered is the default
(back-compat with single-vault clients).
