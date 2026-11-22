cask "xiaoyuanNote" do
  version "4.14.2"
  sha256 "654692cbdfffc0a1a22002a2aa79643a110a5f641440872ab66a60fa96af160c"

  url "https://github.com/zhitongblog/xiaoyuan-note/releases/download/v#{version}/XIAOYUAN_NOTE_#{version}_universal.dmg"
  name "xiaoyuanNote"
  desc "Markdown editor and bridge to your LLM"
  homepage "https://xiaoyuannote.app/"

  livecheck do
    url :url
    strategy :github_latest
  end

  depends_on macos: :big_sur

  app "xiaoyuannote.app"

  zap trash: [
    "~/Library/Application Support/app.xiaoyuannote",
    "~/Library/Caches/app.xiaoyuannote",
    "~/Library/Preferences/app.xiaoyuan-note.plist",
    "~/Library/Saved Application State/app.xiaoyuan-note.savedState",
    "~/Library/WebKit/app.xiaoyuannote",
  ]
end