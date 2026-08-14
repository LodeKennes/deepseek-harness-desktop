cask "deepseek-harness" do
  arch arm: "arm64", intel: "x64"

  version "0.1.0-6"
  sha256 arm:   "3dc6343ec8594daa0fef106c07552aa582377a72f36027681b269e0aee3f3f80",
         intel: "c125632af6e1f7cb9ec5b4282240971c4e67624970446c6d48caac7df0002937"

  url "https://github.com/LodeKennes/deepseek-harness-desktop/releases/download/desktop-v#{version}/DeepSeek-Harness-#{version}-mac-#{arch}.dmg",
      verified: "github.com/LodeKennes/deepseek-harness-desktop/"
  name "DeepSeek Harness"
  desc "Desktop installers for DeepSeek Harness. Everything is a plugin."
  homepage "https://github.com/LodeKennes/deepseek-harness-desktop"

  livecheck do
    url :homepage
    regex(/desktop-v?(\d+(?:\.\d+)+-\d+)/i)
    strategy :github_latest
  end

  depends_on macos: ">= :big_sur"

  app "DeepSeek Harness.app"

  caveats <<~EOS
    This build is unsigned. After installing:

      xattr -dr com.apple.quarantine "/Applications/DeepSeek Harness.app"
  EOS

  zap trash: [
    "~/Library/Application Support/DeepSeek Harness",
    "~/Library/Logs/DeepSeek Harness",
    "~/Library/Preferences/ai.deepseek.harness.desktop.plist",
    "~/Library/Saved Application State/ai.deepseek.harness.desktop.savedState",
  ]
end
