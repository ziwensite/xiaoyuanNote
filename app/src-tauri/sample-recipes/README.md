# Sample agent recipes

Reference recipes for v4.0 Pillar 2 (Agent Recipes). To enable one in
your vault, copy it (renaming away the `.example` suffix) into
`<your vault>/.xiaoyuan-note/agents/`.

These ship under the app's source tree purely so they're versioned
with the schema. xiaoyuanNote’s recipe loader scans
`<workspace>/.xiaoyuan-note/agents/` only — files in this directory don't
auto-fire.

| File | Trigger | What it does |
|---|---|---|
| `_sample-weekly-review.yml.example` | `schedule` (Sundays 18:00) | Summarises the week's `daily/` notes into `weekly/YYYY-WW.md`. |

The full schema lives in `/tmp/xiaoyuan-note-v4-contracts.md` §C4 and
`docs/roadmap.md`'s Pillar 2 section.
