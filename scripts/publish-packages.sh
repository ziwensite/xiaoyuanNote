#!/usr/bin/env bash
# Publish xiaoyuanNote to all package managers in one command.
#
# Usage:
#   ./scripts/publish-packages.sh 0.1.9                 # all platforms
#   ./scripts/publish-packages.sh 0.1.9 brew            # just Homebrew
#   ./scripts/publish-packages.sh 0.1.9 brew winget     # multiple
#
# Supported platforms: brew, winget, choco
# (AUR is NOT supported here — requires SSH access to aur.archlinux.org,
#  see aur-xiaoyuan-note-bin/ for manual submission steps.)
#
# Scoop is intentionally NOT listed — ScoopInstaller/Extras bucket's
# checkver+autoupdate config auto-tracks our GitHub releases, so manual
# PRs are unnecessary and unwanted (see our issue #11 for context).
#
# Prerequisites:
#   - gh CLI authenticated
#   - nuget installed (brew install nuget)
#   - CHOCOLATEY_API_KEY env var or .env.local file with it
#   - Fork repos already exist on your GitHub account:
#       zhitongblog/homebrew-cask, zhitongblog/winget-pkgs, zhitongblog/Extras

set -euo pipefail

if [ "$#" -lt 1 ]; then
    echo "Usage: $0 VERSION [brew|winget|scoop|choco|all]"
    echo "Example: $0 0.1.9"
    exit 1
fi

VERSION="$1"
shift

# Default: all platforms EXCEPT scoop (see #11 — upstream auto-tracks)
if [ "$#" -eq 0 ]; then
    TARGETS=("brew" "winget" "choco")
else
    TARGETS=("$@")
fi

REPO="zhitongblog/xiaoyuan-note"
BASE_URL="https://github.com/${REPO}/releases/download/v${VERSION}"
YOUR_GH="zhitongblog"

# Colors
ORANGE='\033[0;33m'
GREEN='\033[0;32m'
RED='\033[0;31m'
BOLD='\033[1m'
RESET='\033[0m'

info()  { printf "${ORANGE}==>${RESET} ${BOLD}%s${RESET}\n" "$*"; }
ok()    { printf "${GREEN}✓${RESET} %s\n" "$*"; }
fail()  { printf "${RED}✗${RESET} %s\n" "$*" >&2; }

# ==================================================================
# Check release exists on GitHub
# ==================================================================
info "Verifying v${VERSION} release exists on GitHub…"
if ! gh release view "v${VERSION}" --repo "$REPO" >/dev/null 2>&1; then
    fail "Release v${VERSION} not found. Push the tag first."
    exit 1
fi
ok "Release v${VERSION} found"

# ==================================================================
# Download installers and compute SHA256 (cached)
# ==================================================================
CACHE_DIR="/tmp/xiaoyuan-note-release-${VERSION}"
mkdir -p "$CACHE_DIR"

fetch_sha256() {
    local asset="$1"
    local cache_file="${CACHE_DIR}/${asset}.sha256"
    if [ -f "$cache_file" ]; then
        cat "$cache_file"
        return
    fi
    local url="${BASE_URL}/${asset}"
    local sha
    sha=$(curl -sL --max-time 600 "$url" | shasum -a 256 | awk '{print $1}')
    if [ -z "$sha" ] || [ "$sha" = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" ]; then
        fail "Empty hash for $asset — download failed"
        return 1
    fi
    echo "$sha" > "$cache_file"
    echo "$sha"
}

DMG="XIAOYUAN_NOTE_${VERSION}_universal.dmg"
MSI="XIAOYUAN_NOTE_${VERSION}_x64_en-US.msi"
PORTABLE="XIAOYUAN_NOTE_${VERSION}_x64-portable.zip"
APPIMAGE="XIAOYUAN_NOTE_${VERSION}_amd64.AppImage"

# ==================================================================
# Homebrew Cask
# ==================================================================
publish_brew() {
    info "Publishing to Homebrew Cask…"
    local sha
    sha=$(fetch_sha256 "$DMG") || return 1
    ok "DMG SHA256: $sha"

    local repo_dir="/tmp/homebrew-cask"
    if [ ! -d "$repo_dir/.git" ]; then
        info "Cloning Homebrew/homebrew-cask (this takes a while)…"
        gh repo clone Homebrew/homebrew-cask "$repo_dir" -- --depth=1 >/dev/null 2>&1
        (cd "$repo_dir" && git remote add fork "https://github.com/${YOUR_GH}/homebrew-cask.git" 2>/dev/null || true)
    fi

    (
        cd "$repo_dir"
        git fetch origin main 2>&1 | tail -1
        git checkout main 2>/dev/null || git checkout -b main origin/main
        git reset --hard origin/main >/dev/null
        local branch="update-xiaoyuan-note-${VERSION}"
        git checkout -B "$branch" >/dev/null

        cat > "Casks/s/xiaoyuan-note.rb" <<RUBY
cask "xiaoyuanNote" do
  version "${VERSION}"
  sha256 "${sha}"

  url "https://github.com/${REPO}/releases/download/v#{version}/XIAOYUAN_NOTE_#{version}_universal.dmg",
      verified: "github.com/${REPO}/"
  name "xiaoyuanNote"
  desc "Lightweight Markdown and plain text editor"
  homepage "https://xiaoyuannote.app/"

  livecheck do
    url :url
    strategy :github_latest
  end

  depends_on macos: ">= :big_sur"

  app "xiaoyuannote.app"

  zap trash: [
    "~/Library/Application Support/app.xiaoyuannote",
    "~/Library/Caches/app.xiaoyuannote",
    "~/Library/Preferences/app.xiaoyuan-note.plist",
    "~/Library/Saved Application State/app.xiaoyuan-note.savedState",
    "~/Library/WebKit/app.xiaoyuannote",
  ]
end
RUBY

        git add Casks/s/xiaoyuan-note.rb
        git -c user.email=dev@xiaoyuan-note.local -c user.name="${YOUR_GH}" commit -q -m "Update xiaoyuanNote to ${VERSION}"
        git push fork "$branch" --force >/dev/null 2>&1
    )

    local url
    url=$(gh pr create --repo Homebrew/homebrew-cask \
        --head "${YOUR_GH}:update-xiaoyuan-note-${VERSION}" \
        --title "Update xiaoyuanNote to ${VERSION}" \
        --body "Update xiaoyuanNote to v${VERSION}. See release notes: https://github.com/${REPO}/releases/tag/v${VERSION}" 2>&1 | tail -1 || true)
    ok "Homebrew PR: $url"
}

# ==================================================================
# winget
# ==================================================================
publish_winget() {
    info "Publishing to winget…"
    local sha
    sha=$(fetch_sha256 "$MSI") || return 1
    ok "MSI SHA256: $sha"

    local repo_dir="${HOME}/code/notebook/winget-pkgs"
    if [ ! -d "$repo_dir/.git" ]; then
        info "Cloning winget-pkgs (this takes a while)…"
        gh repo clone "${YOUR_GH}/winget-pkgs" "$repo_dir" -- --depth=1 >/dev/null 2>&1
        (cd "$repo_dir" && git remote add upstream https://github.com/microsoft/winget-pkgs.git 2>/dev/null || true)
    fi

    (
        cd "$repo_dir"
        git fetch upstream master 2>&1 | tail -1
        git checkout master 2>/dev/null || git checkout -b master upstream/master
        git reset --hard upstream/master >/dev/null
        local branch="add-xiaoyuan-note-${VERSION}"
        git checkout -B "$branch" >/dev/null

        local manifest_dir="manifests/z/zhitong/xiaoyuan-note/${VERSION}"
        mkdir -p "$manifest_dir"

        local sha_upper
        sha_upper=$(echo "$sha" | tr '[:lower:]' '[:upper:]')
        local today
        today=$(date +%Y-%m-%d)

        cat > "$manifest_dir/zhitong.xiaoyuan-note.yaml" <<YAML
# yaml-language-server: \$schema=https://aka.ms/winget-manifest.version.1.9.0.schema.json

PackageIdentifier: zhitong.xiaoyuanNote
PackageVersion: ${VERSION}
DefaultLocale: en-US
ManifestType: version
ManifestVersion: 1.9.0
YAML

        cat > "$manifest_dir/zhitong.xiaoyuan-note.installer.yaml" <<YAML
# yaml-language-server: \$schema=https://aka.ms/winget-manifest.installer.1.9.0.schema.json

PackageIdentifier: zhitong.xiaoyuanNote
PackageVersion: ${VERSION}
MinimumOSVersion: 10.0.17763.0
InstallerType: wix
UpgradeBehavior: install
FileExtensions:
- md
- markdown
- mdown
- mkd
ReleaseDate: ${today}
Installers:
- Architecture: x64
  InstallerUrl: https://github.com/${REPO}/releases/download/v${VERSION}/XIAOYUAN_NOTE_${VERSION}_x64_en-US.msi
  InstallerSha256: ${sha_upper}
ManifestType: installer
ManifestVersion: 1.9.0
YAML

        cat > "$manifest_dir/zhitong.xiaoyuan-note.locale.en-US.yaml" <<YAML
# yaml-language-server: \$schema=https://aka.ms/winget-manifest.defaultLocale.1.9.0.schema.json

PackageIdentifier: zhitong.xiaoyuanNote
PackageVersion: ${VERSION}
PackageLocale: en-US
Publisher: zhitong
PublisherUrl: https://github.com/${YOUR_GH}
PublisherSupportUrl: https://github.com/${REPO}/issues
PackageName: xiaoyuanNote
PackageUrl: https://xiaoyuannote.app
License: MIT
LicenseUrl: https://github.com/${REPO}/blob/main/LICENSE
Copyright: Copyright (c) 2026 xiangdong li
ShortDescription: A lightweight Markdown and plain text editor
Description: |-
  xiaoyuanNote is a free, open-source, cross-platform Markdown + plain text editor
  built with Tauri 2 + Vue 3 + CodeMirror 6. Under 15 MB installed.
Moniker: xiaoyuanNote
Tags:
- editor
- markdown
- text-editor
- tauri
- vim
ReleaseNotesUrl: https://github.com/${REPO}/releases/tag/v${VERSION}
Documentations:
- DocumentLabel: Website
  DocumentUrl: https://xiaoyuannote.app
ManifestType: defaultLocale
ManifestVersion: 1.9.0
YAML

        git add "$manifest_dir/"
        git -c user.email=dev@xiaoyuan-note.local -c user.name="${YOUR_GH}" commit -q -m "New version: zhitong.xiaoyuanNote version ${VERSION}"
        git push origin "$branch" --force >/dev/null 2>&1
    )

    local url
    url=$(gh pr create --repo microsoft/winget-pkgs \
        --head "${YOUR_GH}:add-xiaoyuan-note-${VERSION}" \
        --title "New version: zhitong.xiaoyuanNote version ${VERSION}" \
        --body "Update xiaoyuanNote to v${VERSION}. Release notes: https://github.com/${REPO}/releases/tag/v${VERSION}" 2>&1 | tail -1 || true)
    ok "winget PR: $url"
}

# ==================================================================
# Scoop
# ==================================================================
publish_scoop() {
    info "Publishing to Scoop Extras…"
    local sha
    sha=$(fetch_sha256 "$PORTABLE") || return 1
    ok "Portable ZIP SHA256: $sha"

    local repo_dir="/tmp/scoop-extras"
    if [ ! -d "$repo_dir/.git" ]; then
        info "Cloning ScoopInstaller/Extras (this takes a while)…"
        gh repo clone ScoopInstaller/Extras "$repo_dir" -- --depth=1 >/dev/null 2>&1
        (cd "$repo_dir" && git remote add fork "https://github.com/${YOUR_GH}/Extras.git" 2>/dev/null || true; git remote add upstream https://github.com/ScoopInstaller/Extras.git 2>/dev/null || true)
    fi

    (
        cd "$repo_dir"
        git fetch upstream master 2>&1 | tail -1
        git checkout master 2>/dev/null || git checkout -b master upstream/master
        git reset --hard upstream/master >/dev/null
        local branch="update-xiaoyuan-note-${VERSION}"
        git checkout -B "$branch" >/dev/null

        cat > "bucket/xiaoyuan-note.json" <<JSON
{
    "version": "${VERSION}",
    "description": "A lightweight Markdown and plain text editor built with Tauri 2",
    "homepage": "https://xiaoyuannote.app",
    "license": "MIT",
    "architecture": {
        "64bit": {
            "url": "https://github.com/${REPO}/releases/download/v${VERSION}/XIAOYUAN_NOTE_${VERSION}_x64-portable.zip",
            "hash": "${sha}"
        }
    },
    "bin": "xiaoyuan-note.exe",
    "shortcuts": [
        [
            "xiaoyuan-note.exe",
            "xiaoyuanNote"
        ]
    ],
    "checkver": "github",
    "autoupdate": {
        "architecture": {
            "64bit": {
                "url": "https://github.com/${REPO}/releases/download/v\$version/XIAOYUAN_NOTE_\$version_x64-portable.zip",
                "hash": {
                    "url": "https://github.com/${REPO}/releases/tag/v\$version",
                    "regex": "XIAOYUAN_NOTE_\$version_x64-portable\\\\.zip.*?\$sha256"
                }
            }
        }
    }
}
JSON

        git add bucket/xiaoyuan-note.json
        git -c user.email=dev@xiaoyuan-note.local -c user.name="${YOUR_GH}" commit -q -m "xiaoyuan-note: Update to ${VERSION}"
        git push fork "$branch" --force >/dev/null 2>&1
    )

    local url
    url=$(gh pr create --repo ScoopInstaller/Extras \
        --head "${YOUR_GH}:update-xiaoyuan-note-${VERSION}" \
        --title "xiaoyuan-note: Update to ${VERSION}" \
        --body "Update xiaoyuanNote to v${VERSION}. Release notes: https://github.com/${REPO}/releases/tag/v${VERSION}" 2>&1 | tail -1 || true)
    ok "Scoop PR: $url"
}

# ==================================================================
# Chocolatey
# ==================================================================
publish_choco() {
    info "Publishing to Chocolatey…"

    # Load API key
    local api_key="${CHOCOLATEY_API_KEY:-}"
    if [ -z "$api_key" ] && [ -f "${PWD}/.env.local" ]; then
        # Try to source it
        api_key=$(grep -E '^CHOCOLATEY_API_KEY=' "${PWD}/.env.local" | head -1 | cut -d= -f2- | tr -d '"'"'"'"')
    fi
    if [ -z "$api_key" ]; then
        fail "CHOCOLATEY_API_KEY not set. Export it or put in .env.local"
        return 1
    fi

    local sha
    sha=$(fetch_sha256 "$MSI") || return 1
    ok "MSI SHA256: $sha"

    if ! command -v nuget >/dev/null 2>&1; then
        fail "nuget not installed. Run: brew install nuget"
        return 1
    fi

    local pkg_dir="/tmp/choco-xiaoyuan-note-${VERSION}"
    rm -rf "$pkg_dir"
    mkdir -p "$pkg_dir/tools"
    cd "$pkg_dir"

    cat > xiaoyuan-note.nuspec <<NUSPEC
<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://schemas.microsoft.com/packaging/2010/07/nuspec.xsd">
  <metadata>
    <id>xiaoyuanNote</id>
    <version>${VERSION}</version>
    <title>xiaoyuanNote</title>
    <authors>zhitong</authors>
    <owners>zhitong</owners>
    <projectUrl>https://xiaoyuannote.app</projectUrl>
    <iconUrl>https://raw.githubusercontent.com/${REPO}/main/brand/XIAOYUAN_NOTE_icon_fullbleed.png</iconUrl>
    <licenseUrl>https://github.com/${REPO}/blob/main/LICENSE</licenseUrl>
    <requireLicenseAcceptance>false</requireLicenseAcceptance>
    <tags>markdown editor text-editor tauri vim lightweight</tags>
    <summary>A lightweight Markdown and plain text editor built with Tauri 2</summary>
    <description>xiaoyuanNote is a free, open-source Markdown + plain text editor. Under 15 MB installed.

Built with Tauri 2 + Vue 3 + CodeMirror 6 + Rust.

Project source: https://github.com/${REPO}
Documentation: https://xiaoyuannote.app</description>
    <releaseNotes>https://github.com/${REPO}/releases/tag/v${VERSION}</releaseNotes>
    <copyright>Copyright (c) 2026 xiangdong li</copyright>
  </metadata>
  <files>
    <file src="tools\\**" target="tools" />
  </files>
</package>
NUSPEC

    cat > tools/chocolateyinstall.ps1 <<PS1
\$ErrorActionPreference = 'Stop'
\$packageArgs = @{
    packageName    = 'xiaoyuanNote'
    fileType       = 'msi'
    url64bit       = 'https://github.com/${REPO}/releases/download/v${VERSION}/XIAOYUAN_NOTE_${VERSION}_x64_en-US.msi'
    checksum64     = '${sha}'
    checksumType64 = 'sha256'
    silentArgs     = '/qn /norestart'
    validExitCodes = @(0, 3010, 1641)
}
Install-ChocolateyPackage @packageArgs
PS1

    cat > tools/chocolateyuninstall.ps1 <<'PS1'
$ErrorActionPreference = 'Stop'
$packageArgs = @{
    packageName    = 'xiaoyuanNote'
    softwareName   = 'xiaoyuanNote*'
    fileType       = 'msi'
    silentArgs     = '/qn /norestart'
    validExitCodes = @(0, 3010, 1605, 1614, 1641)
}
[array]$key = Get-UninstallRegistryKey -SoftwareName $packageArgs['softwareName']
if ($key.Count -ge 1) {
    $key[0] | ForEach-Object {
        $packageArgs['file'] = ''
        $packageArgs['silentArgs'] = "$($_.PSChildName) $($packageArgs['silentArgs'])"
        Uninstall-ChocolateyPackage @packageArgs
    }
}
PS1

    nuget pack xiaoyuan-note.nuspec 2>&1 | tail -2
    nuget push "xiaoyuan-note.${VERSION}.nupkg" -Source https://push.chocolatey.org/ -ApiKey "$api_key" 2>&1 | tail -3 \
        && ok "Chocolatey: pushed (awaiting moderation)" \
        || fail "Chocolatey: push failed (previous version may still be in moderation)"
}

# ==================================================================
# Run selected targets
# ==================================================================
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

for target in "${TARGETS[@]}"; do
    case "$target" in
        brew)   publish_brew ;;
        winget) publish_winget ;;
        scoop)  fail "Scoop target disabled — upstream auto-tracks via checkver/autoupdate. See issue #11." ;;
        choco)  publish_choco ;;
        all)    publish_brew; publish_winget; publish_choco ;;
        *)      fail "Unknown target: $target (use: brew|winget|choco|all)" ;;
    esac
done

info "Done."
