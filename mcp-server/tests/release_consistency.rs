//! Release-facing files drift from the code in three different ways, and none
//! of them was caught by a test before:
//!
//!   1. `scripts/release.sh` bumps six version fields; a hand-made bump can
//!      forget one, and the structured-data / website versions were never
//!      checked at all.
//!   2. `server.json` and `distribution/manifests/*` describe *published*
//!      artifacts (a .mcpb URL plus its sha256, installer URLs). They are
//!      legitimately allowed to lag behind the in-tree version, but they must
//!      stay internally consistent and must never point at a release that
//!      does not exist yet.
//!   3. Marketing copy quoted "13 tools" long after the server grew to 16.
//!      The tool inventory has a real source of truth (`src/tools.rs`) that
//!      the static listings can be compared against.
//!
//! This test only reads repository text: no MCP server, no network, no new
//! dependency. Skipped when the crate is built outside the SoloMD repo (e.g.
//! from crates.io), like `version_sync.rs`.

use serde_json::Value;
use std::collections::BTreeSet;
use std::path::PathBuf;

fn repo_file(rel: &str) -> Option<String> {
    let p = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join(rel);
    std::fs::read_to_string(p).ok()
}

fn read(rel: &str) -> String {
    repo_file(rel).unwrap_or_else(|| panic!("missing repo file: {rel}"))
}

fn in_repo() -> bool {
    repo_file("app/src-tauri/tauri.conf.json").is_some()
}

fn json_version(raw: &str) -> String {
    let v: Value = serde_json::from_str(raw).expect("valid JSON");
    v["version"]
        .as_str()
        .expect("top-level string version")
        .to_string()
}

fn toml_version(raw: &str) -> String {
    raw.lines()
        .find_map(|l| l.strip_prefix("version = \""))
        .and_then(|rest| rest.split('"').next())
        .expect("Cargo.toml package version")
        .to_string()
}

fn cli_version(raw: &str) -> String {
    raw.lines()
        .find_map(|l| l.strip_prefix("SOLOMD_VERSION=\""))
        .and_then(|rest| rest.split('"').next())
        .expect("SOLOMD_VERSION in scripts/solomd")
        .to_string()
}

fn schema_version(raw: &str) -> String {
    raw.lines()
        .find_map(|l| {
            l.trim()
                .strip_prefix("\"softwareVersion\": \"")?
                .split('"')
                .next()
        })
        .expect("softwareVersion in web/src/layouts/Layout.astro")
        .to_string()
}

fn app_version() -> String {
    json_version(&read("app/src-tauri/tauri.conf.json"))
}

fn semver(v: &str) -> (u64, u64, u64) {
    let mut parts = v.split('.').map(|p| p.parse::<u64>().expect("numeric semver"));
    (
        parts.next().expect("major"),
        parts.next().expect("minor"),
        parts.next().expect("patch"),
    )
}

#[test]
fn every_in_tree_version_matches_the_app() {
    if !in_repo() {
        eprintln!("skipping: not inside the SoloMD repo");
        return;
    }
    let app = app_version();
    assert_eq!(
        env!("CARGO_PKG_VERSION"),
        app,
        "mcp-server/Cargo.toml must equal the app version"
    );
    let sources: Vec<(&str, String)> = vec![
        ("app/package.json", json_version(&read("app/package.json"))),
        (
            "app/src-tauri/Cargo.toml",
            toml_version(&read("app/src-tauri/Cargo.toml")),
        ),
        (
            "mcp-server/mcpb/manifest.json",
            json_version(&read("mcp-server/mcpb/manifest.json")),
        ),
        ("scripts/solomd", cli_version(&read("scripts/solomd"))),
        (
            "web/src/layouts/Layout.astro",
            schema_version(&read("web/src/layouts/Layout.astro")),
        ),
    ];
    for (path, got) in sources {
        assert_eq!(got, app, "{path} drifted; run scripts/release.sh");
    }
    // The 15 locale badges are prose, not structured data, but release.sh
    // bumps them too — check one copy at least stays on the current version.
    assert!(
        read("web/src/i18n/translations.ts").contains(&format!("v{app} ·")),
        "translations.ts locale badges drifted; run scripts/release.sh"
    );
}

fn yaml_package_version(raw: &str) -> String {
    raw.lines()
        .find_map(|l| l.trim().strip_prefix("PackageVersion: "))
        .expect("winget PackageVersion")
        .trim()
        .to_string()
}

fn quoted_version(raw: &str, prefix: &str) -> String {
    raw.lines()
        .find_map(|l| l.trim().strip_prefix(prefix))
        .and_then(|rest| rest.split('"').next())
        .unwrap_or_else(|| panic!("missing {prefix}"))
        .to_string()
}

#[test]
fn published_artifacts_are_self_consistent_and_never_ahead_of_the_app() {
    if !in_repo() {
        return;
    }
    let app = semver(&app_version());

    // server.json: version, the release URL and the sha describe one .mcpb.
    let server: Value = serde_json::from_str(&read("server.json")).expect("valid server.json");
    let version = server["version"].as_str().expect("server.json version");
    let pkg = &server["packages"][0];
    let identifier = pkg["identifier"].as_str().expect("mcpb identifier");
    let sha = pkg["fileSha256"].as_str().expect("mcpb sha256");
    assert!(
        identifier.contains(&format!("/v{version}/")),
        "server.json identifier must point at its own version: {identifier}"
    );
    assert!(
        identifier.ends_with(&format!("solomd-mcp-{version}.mcpb")),
        "server.json identifier must name the .mcpb for {version}: {identifier}"
    );
    assert_eq!(sha.len(), 64, "fileSha256 must be a full sha256 hex digest");
    assert!(
        sha.bytes().all(|b| b.is_ascii_hexdigit()),
        "fileSha256 must be hex: {sha}"
    );
    assert!(
        semver(version) <= app,
        "server.json {version} is newer than the in-tree app; publish first"
    );

    // distribution manifests: one release per set, and URLs agree with it.
    let winget = [
        "distribution/manifests/winget/zhitong.SoloMD.yaml",
        "distribution/manifests/winget/zhitong.SoloMD.locale.en-US.yaml",
        "distribution/manifests/winget/zhitong.SoloMD.locale.zh-CN.yaml",
        "distribution/manifests/winget/zhitong.SoloMD.installer.yaml",
    ]
    .map(|p| (p, read(p)));
    let dist = yaml_package_version(&winget[0].1);
    for (path, raw) in &winget {
        assert_eq!(
            yaml_package_version(raw),
            dist,
            "{path} describes a different winget release"
        );
    }
    let installer = &winget[3].1;
    assert!(
        installer.contains(&format!("/v{dist}/")),
        "winget InstallerUrl must point at v{dist}"
    );
    assert!(
        winget[1].1.contains(&format!("/tag/v{dist}")),
        "winget ReleaseNotesUrl must point at v{dist}"
    );
    let scoop = read("distribution/manifests/scoop/solomd.json");
    assert_eq!(json_version(&scoop), dist, "scoop manifest drifted");
    let cask = read("distribution/manifests/homebrew/solomd.rb");
    assert_eq!(
        quoted_version(&cask, "version \""),
        dist,
        "homebrew cask drifted"
    );
    assert!(
        semver(&dist) <= app,
        "distribution manifests {dist} are newer than the in-tree app"
    );
}

/// `#[tool(` is a multi-line attribute; `name = "..."` is on its own line.
fn code_tools(src: &str) -> BTreeSet<String> {
    let mut out = BTreeSet::new();
    let mut inside = false;
    for line in src.lines() {
        let t = line.trim();
        if t.starts_with("#[tool(") {
            inside = true;
            continue;
        }
        if inside {
            if let Some(rest) = t.strip_prefix("name = \"") {
                out.insert(rest.split('"').next().unwrap().to_string());
            }
            if t.starts_with(")]") {
                inside = false;
            }
        }
    }
    out
}

fn manifest_tools(raw: &str) -> BTreeSet<String> {
    let v: Value = serde_json::from_str(raw).expect("valid mcpb manifest");
    v["tools"]
        .as_array()
        .expect("mcpb tools array")
        .iter()
        .map(|t| t["name"].as_str().expect("tool name").to_string())
        .collect()
}

fn smithery_tools(raw: &str) -> BTreeSet<String> {
    let mut out = BTreeSet::new();
    let mut inside = false;
    for line in raw.lines() {
        if line == "tools:" {
            inside = true;
            continue;
        }
        if !inside {
            continue;
        }
        if !line.starts_with(' ') && !line.trim().is_empty() {
            break;
        }
        if let Some(name) = line.trim().strip_prefix("- name: ") {
            out.insert(name.trim().to_string());
        }
    }
    out
}

#[test]
fn static_tool_inventories_match_the_code() {
    if !in_repo() {
        return;
    }
    let code = code_tools(&read("mcp-server/src/tools.rs"));
    assert_eq!(code.len(), 16, "src/tools.rs defines 16 tools");
    for write_tool in [
        "write_note",
        "append_to_note",
        "autogit_rollback",
        "export_note",
    ] {
        assert!(
            code.contains(write_tool),
            "{write_tool} is missing from src/tools.rs"
        );
    }
    // `export_note` is removed from the router when the Node export backend
    // is unavailable (tests/write_safety.rs asserts 15 vs 16 at runtime).
    let listed: BTreeSet<String> = code
        .iter()
        .filter(|n| n.as_str() != "export_note")
        .cloned()
        .collect();
    assert_eq!(listed.len(), 15);

    assert_eq!(
        manifest_tools(&read("mcp-server/mcpb/manifest.json")),
        listed,
        "mcpb manifest tools are generated from the live tools/list"
    );
    let root = read("smithery.yaml");
    let mirror = read("marketplace/smithery/smithery.yaml");
    assert_eq!(root, mirror, "the two smithery.yaml files must stay mirrored");
    for (path, raw) in [("smithery.yaml", &root), ("marketplace/smithery/smithery.yaml", &mirror)] {
        assert_eq!(smithery_tools(raw), listed, "{path} tool inventory drifted");
    }
}

/// Copy that must never quote a superseded tool count again. Historical
/// comparisons (`web/src/pages/compare/vs-typora.astro` says "v3.1") and old
/// release blog posts are intentionally excluded.
const PUBLIC_TOOL_COPY: &[&str] = &[
    "README.md",
    "README.zh.md",
    "README.de.md",
    "README.nl.md",
    "README.it.md",
    "README.es.md",
    "README.fr.md",
    "README.ja.md",
    "README.pl.md",
    "README.pt.md",
    "README.sv.md",
    "README.tr.md",
    "README.uk.md",
    "mcp-server/README.md",
    "smithery.yaml",
    "marketplace/smithery/smithery.yaml",
    "marketplace/smithery/README.md",
    "marketplace/smithery/listing.md",
    "marketplace/README.md",
    "marketplace/_shared/tools.md",
    "marketplace/_shared/badges.md",
    "marketplace/client-docs/zed.md",
    "marketplace/client-docs/cursor.md",
    "marketplace/client-docs/continue.md",
    "marketplace/client-docs/cline.md",
    "marketplace/client-docs/claude-desktop.md",
    "marketplace/client-docs/claude-code.md",
    "marketplace/claude-code-skill/solomd/SKILL.md",
    "marketplace/claude-code-skill/solomd/install.sh",
    "marketplace/claude-code-skill/README.md",
    "marketplace/awesome-mcp/README.md",
    "marketplace/awesome-mcp/pr-body.md",
    "marketplace/awesome-mcp/entry-wong2.md",
    "marketplace/awesome-mcp/entry-punkpeye.md",
    "marketplace/awesome-mcp/entry-appcypher.md",
    "web/public/llms.txt",
    "web/public/llms-full.txt",
    "web/src/i18n/translations.ts",
    "web/src/components/Compare.astro",
    "web/src/pages/compare/vs-tolaria.astro",
];

const STALE_TOOL_PHRASES: &[&str] = &[
    "13 tools",
    "13 Tools",
    "13 tools standaard",
    "13 strumenti",
    "13 herramientas",
    "13 outils",
    "13 ツール",
    "13 narzędzi",
    "13 ferramentas",
    "13 verktyg",
    "13 araç",
    "13 інструментів",
    "13 JSON-RPC tools",
    "13 MCP tools",
    "13 个工具",
    "8 read tools",
    "8 read-only tools",
    "8 read + 2 write",
    "8 generic",
    "8 generiek",
    "8 generisch",
    "8 generici",
    "8 genéricas",
    "8 génériques",
    "8 generycznych",
    "8 jenerik",
    "8 загальних",
    "8 generiska",
    "汎用 8",
    "5 SoloMD-only",
    "5 SoloMD-eigen",
    "5 SoloMD-eigene",
    "5 specifici SoloMD",
    "the 3 write tools",
    "off 13",
];

#[test]
fn public_copy_does_not_quote_a_superseded_tool_count() {
    if !in_repo() {
        return;
    }
    for path in PUBLIC_TOOL_COPY {
        let raw = read(path);
        for phrase in STALE_TOOL_PHRASES {
            assert!(
                !raw.contains(phrase),
                "{path} still says \"{phrase}\"; the server has 16 tools (15 listed by default)"
            );
        }
    }
}
