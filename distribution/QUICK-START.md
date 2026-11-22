# 快速上架指南

> 按照以下步骤，快速完成软件上架

---

## 1. Homebrew Cask (macOS) - 最推荐

```bash
# 进入 xiaoyuanNote 目录
cd D:/code/xiaoyuan-note/xiaoyuanNote

# Fork 并 clone homebrew-cask
gh repo fork homebrew/homebrew-cask --clone
cd homebrew-cask

# 复制 manifest 文件
cp ../distribution/manifests/homebrew/xiaoyuan-note.rb Casks/s/xiaoyuan-note.rb

# 创建分支并提交
git checkout -b add-xiaoyuanNote
git add Casks/s/xiaoyuan-note.rb
git commit -m "Add xiaoyuanNote v0.1.8"

# 创建 PR
gh pr create --title "Add xiaoyuanNote v0.1.8" --body "Add xiaoyuanNote - A lightweight Markdown editor with live preview.

**Homepage:** https://xiaoyuannote.app
**GitHub:** https://github.com/zhitongblog/xiaoyuan-note

xiaoyuanNote is a lightweight (~15MB) cross-platform Markdown editor built with Tauri 2.

- Live preview (WYSIWYG-style)
- KaTeX math, Mermaid diagrams
- Multi-encoding support
- Export to PDF, DOCX, HTML"
```

---

## 2. Winget (Windows) - 最推荐

```bash
# 进入 xiaoyuanNote 目录
cd D:/code/xiaoyuan-note/xiaoyuanNote

# Fork 并 clone winget-pkgs
gh repo fork microsoft/winget-pkgs --clone
cd winget-pkgs

# 创建目录结构
mkdir -p manifests/z/zhitongblog/xiaoyuan-note/0.1.8

# 复制 manifest 文件
cp ../distribution/manifests/winget/*.yaml manifests/z/zhitongblog/xiaoyuan-note/0.1.8/

# 创建分支并提交
git checkout -b add-xiaoyuan-note-0.1.8
git add manifests/z/zhitongblog/xiaoyuan-note/
git commit -m "Add xiaoyuanNote version 0.1.8"

# 创建 PR
gh pr create --title "New package: zhitongblog.xiaoyuanNote version 0.1.8" --body "## Package Information
- Package: zhitongblog.xiaoyuanNote
- Version: 0.1.8

## Description
xiaoyuanNote is a lightweight Markdown editor with live preview. Built with Tauri 2.

## Links
- Homepage: https://xiaoyuannote.app
- GitHub: https://github.com/zhitongblog/xiaoyuan-note"
```

---

## 3. Scoop (Windows)

```bash
# 进入 xiaoyuanNote 目录
cd D:/code/xiaoyuan-note/xiaoyuanNote

# Fork 并 clone Scoop Extras
gh repo fork ScoopInstaller/Extras --clone
cd Extras

# 复制 manifest 文件
cp ../distribution/manifests/scoop/xiaoyuan-note.json bucket/xiaoyuan-note.json

# 创建分支并提交
git checkout -b add-xiaoyuanNote
git add bucket/xiaoyuan-note.json
git commit -m "xiaoyuan-note: Add version 0.1.8"

# 创建 PR
gh pr create --title "xiaoyuan-note: Add version 0.1.8" --body "**Homepage:** https://xiaoyuannote.app

A lightweight Markdown editor with live preview."
```

---

## 4. Chocolatey (Windows)

```bash
# 安装 Chocolatey (如果没有)
# 以管理员身份运行 PowerShell:
# Set-ExecutionPolicy Bypass -Scope Process -Force; iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))

# 进入 chocolatey 目录
cd D:/code/xiaoyuan-note/xiaoyuan-note/distribution/manifests/chocolatey

# 打包
choco pack

# 测试安装（可选）
choco install xiaoyuanNote -s . --force

# 获取 API Key: https://community.chocolatey.org/account
# 然后推送
choco push xiaoyuan-note.0.1.8.nupkg --source https://push.chocolatey.org/ --api-key YOUR_API_KEY
```

---

## 5. SourceForge

1. 访问 https://sourceforge.net/create/
2. 登录/注册
3. 按 `submissions/sourceforge.md` 中的信息填写
4. 上传 `distribution/windows/`, `distribution/macos/`, `distribution/linux/` 中的文件

---

## 6. AlternativeTo

1. 访问 https://alternativeto.net/software/add/
2. 按 `submissions/alternativeto.md` 中的信息填写
3. 提交

---

## 7. 小众软件

1. 访问 https://meta.appinn.net/c/faxian/10
2. 复制 `submissions/appinn.md` 中的内容发帖
3. 或发邮件到 hi@appinn.com

---

## 版本更新检查清单

每次发布新版本时：

- [ ] 更新 `manifests/homebrew/xiaoyuan-note.rb` 中的 version 和 sha256
- [ ] 更新 `manifests/winget/*.yaml` 中的版本号和哈希
- [ ] 更新 `manifests/scoop/xiaoyuan-note.json` 中的版本号和哈希
- [ ] 更新 `manifests/chocolatey/` 中的版本号和哈希
- [ ] 提交更新 PR 到各仓库
- [ ] 更新 SourceForge 文件

---

## 进度追踪

| 平台 | 状态 | PR/链接 | 备注 |
|------|------|---------|------|
| Homebrew | ⏳ 待提交 | | |
| Winget | ⏳ 待提交 | | |
| Scoop | ⏳ 待提交 | | |
| Chocolatey | ⏳ 待提交 | | |
| SourceForge | ⏳ 待提交 | | |
| AlternativeTo | ⏳ 待提交 | | |
| 小众软件 | ⏳ 待提交 | | |
