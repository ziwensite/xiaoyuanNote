# Claude Code Skill — xiaoyuanNote

## Status

⏳ **Ready to submit** once Anthropic's official Skill marketplace opens
public listings. As of writing the Skill mechanism is live in Claude Code
(SKILL.md under `~/.claude/skills/<name>/`) but the discoverable index is
still in early access — for now we ship the skill as a downloadable
folder users can drop into their Claude Code config, and we link to it
from our root README.

## What's here

| Path | Purpose |
|---|---|
| [`xiaoyuan-note/SKILL.md`](xiaoyuan-note/SKILL.md) | The skill itself. Frontmatter + instructions Claude Code reads when the skill is loaded. |
| [`xiaoyuan-note/install.sh`](xiaoyuan-note/install.sh) | One-liner that downloads `xiaoyuan-note-mcp` and registers it as a user-scope MCP server (`~/.claude.json`). |
| [`xiaoyuan-note/recipes/`](xiaoyuan-note/recipes/) | The same 11 YAML recipes as the Skill Pack — included here so the skill is self-contained. |

## Installing the skill in Claude Code

```bash
# Option A — Clone from the xiaoyuanNote repo (recommended; tracks updates):
git clone https://github.com/zhitongblog/xiaoyuan-note.git /tmp/xiaoyuan-note-skill
cp -r /tmp/xiaoyuan-note-skill/marketplace/claude-code-skill/xiaoyuanNote ~/.claude/skills/xiaoyuanNote
bash ~/.claude/skills/xiaoyuan-note/install.sh

# Option B — One-shot installer:
curl -L https://raw.githubusercontent.com/zhitongblog/xiaoyuan-note/main/marketplace/claude-code-skill/xiaoyuan-note/install.sh | bash
```

After install, start a new Claude Code session in your notes folder and
type `/skills`. `xiaoyuanNote` should appear in the list. Activate with
`/skills xiaoyuanNote` and Claude Code will load the SKILL.md instructions and
have the 16 MCP tools available.

## Submitting to the official marketplace (when it opens)

When Anthropic publishes the Skill marketplace submission process,
the path will look like:

1. Fork their skill registry repo.
2. Add `skills/xiaoyuan-note/` mirroring the `xiaoyuan-note/` directory here.
3. Open a PR with the body from [`pr-body.md`](pr-body.md) (below).

## Maintaining

When xiaoyuanNote’s MCP gains/loses a tool, update:

- `xiaoyuan-note/SKILL.md` — the "Tools available" section.
- `xiaoyuan-note/recipes/` — copy from `app/src-tauri/cookbook/`.
- This README's tool count if it ever moves off 16.
