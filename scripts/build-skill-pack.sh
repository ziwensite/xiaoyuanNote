#!/usr/bin/env bash
# Build xiaoyuan-note-skills-vX.Y.Z.zip — the downloadable Skill Pack.
#
# Bundles `app/src-tauri/cookbook/*.yml` (the 11 reference Agent Recipes)
# into a single zip that any xiaoyuan-note-mcp client can drop straight into
# `<workspace>/.xiaoyuan-note/agents/` to get the cookbook live.
#
# Run from repo root:  ./scripts/build-skill-pack.sh
# Output:              dist/xiaoyuan-note-skills-v<version>.zip
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION=$(node -p "require('./app/package.json').version")
SRC=app/src-tauri/cookbook
OUT_DIR=dist
OUT="$OUT_DIR/xiaoyuan-note-skills-v${VERSION}.zip"
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT

PACK_DIR="$STAGE/xiaoyuan-note-skills-v${VERSION}"
mkdir -p "$PACK_DIR/.xiaoyuan-note/agents"
cp "$SRC"/*.yml "$PACK_DIR/.xiaoyuan-note/agents/"

cat > "$PACK_DIR/README.md" <<EOF
# xiaoyuanNote Skill Pack — v${VERSION}

11 reference Agent Recipes for [xiaoyuanNote](https://xiaoyuannote.app) and any
\`xiaoyuan-note-mcp\`-compatible client. Each recipe is a single YAML file under
\`.xiaoyuan-note/agents/\` — no build step, no plugin manifest.

## Install

Unzip into the root of any Markdown notes folder:

\`\`\`bash
unzip xiaoyuan-note-skills-v${VERSION}.zip
mv xiaoyuan-note-skills-v${VERSION}/.xiaoyuanNote YOUR_VAULT/
\`\`\`

If you're running [xiaoyuanNote](https://xiaoyuannote.app), the app's recipe loader
will pick them up on next launch (watch \`Settings → Recipes\`). If you're
running \`xiaoyuan-note-mcp\` standalone with another client (Claude Code,
Cursor, …), the recipes describe themselves — read them and adapt the
\`provider\` / \`model\` / \`prompt\` fields to your client's conventions.

## Recipes

| File | Trigger | What it does |
|---|---|---|
| \`01-weekly-review.yml\` | schedule (Sun 18:00) | Summarise \`daily/\` notes into \`weekly/YYYY-WW.md\` |
| \`02-todo-extract.yml\` | on-save | Pull \`- [ ]\` lines from any note into \`todos.md\` |
| \`03-translate-zh-to-en.yml\` | on-tag-add \`#translate\` | Translate Chinese notes to English alongside the original |
| \`04-cjk-proofread.yml\` | on-save | Local-Ollama CJK punctuation + grammar pass |
| \`05-citation-cleanup.yml\` | on-tag-add \`#cite\` | Normalise bibliographic refs |
| \`06-meeting-notes-summary.yml\` | on-save | Generate decision/action sections after meeting notes |
| \`07-link-suggester.yml\` | on-save | Propose wikilinks based on semantic search |
| \`08-daily-summary.yml\` | schedule (daily 22:00) | Roll up today's edits into a daily log entry |
| \`09-orphan-notes.yml\` | schedule (weekly) | Find notes with no incoming wikilinks |
| \`10-on-commit-changelog.yml\` | on-commit | Maintain a \`CHANGELOG.md\` from commit messages |
| \`11-tag-classifier.yml\` | on-save | Suggest tags based on note content |

## Safety model

- Every run executes on its own AutoGit branch (\`agent/<recipe>/<run-id>\`).
- Writes don't reach \`main\` until you click **Accept** in xiaoyuanNote’s
  Pending UI (or merge the branch manually with another client).
- \`allow-write: false\` by default. \`write-cap\` hard ceiling of 50.

## xiaoyuanNote

These recipes are the canonical examples from xiaoyuanNote’s v4.0 Agent
Recipes spec. The full schema lives at
[docs/agents.md](https://github.com/zhitongblog/xiaoyuan-note/blob/main/docs/agents.md).

If you want the GUI for managing runs (Pending / Accept / Reject /
Replay), get the desktop app:

- **macOS**: [Download .dmg](https://github.com/zhitongblog/xiaoyuan-note/releases/latest)
- **Windows**: [Download .msi](https://github.com/zhitongblog/xiaoyuan-note/releases/latest)
- **Linux**: [Download .deb / .rpm / .AppImage](https://github.com/zhitongblog/xiaoyuan-note/releases/latest)
- **Mobile**: Android APK / iOS App Store — see [xiaoyuannote.app](https://xiaoyuannote.app)

MIT licensed. Issues & PRs welcome at
[github.com/zhitongblog/xiaoyuan-note](https://github.com/zhitongblog/xiaoyuan-note).
EOF

mkdir -p "$OUT_DIR"
(cd "$STAGE" && zip -qr "$OLDPWD/$OUT" "xiaoyuan-note-skills-v${VERSION}")

echo "Built: $OUT"
ls -lh "$OUT"
unzip -l "$OUT" | tail -20
