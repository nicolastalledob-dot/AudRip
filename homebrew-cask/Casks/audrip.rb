cask "audrip" do
  version "1.2.0"
  sha256 :no_check

  url "https://github.com/nmtb97/AudRip/releases/download/v#{version}/AudRip-#{version}-arm64.dmg"
  name "AudRip"
  desc "Download audio from YouTube and SoundCloud with metadata editing"
  homepage "https://github.com/nmtb97/AudRip"

  livecheck do
    url :url
    strategy :github_latest
  end

  app "AudRip.app"

  zap trash: [
    "~/Library/Application Support/audrip",
    "~/Library/Preferences/com.audrip.app.plist",
    "~/Library/Saved Application State/com.audrip.app.savedState",
  ]
end
