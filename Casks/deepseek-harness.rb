cask "deepseek-harness" do
  arch arm: "arm64", intel: "x64"

  version "0.1.1-rc.1-build-11"
  sha256 arm:   "e6b3b46659af78f357b1b9627812f35155d719db42e666be41d5777f4c16e8d0",
         intel: "4daf8600b80525301f2bacf86ca77d15a2a89cad8556c6723168246694ddc842"

  url "https://github.com/LodeKennes/deepseek-harness-desktop/releases/download/desktop-v#{version}/DeepSeek-Harness-#{version}-mac-#{arch}.dmg",
      verified: "github.com/LodeKennes/deepseek-harness-desktop/"
  name "DeepSeek Harness"
  desc "Desktop installers for DeepSeek Harness. Everything is a plugin."
  homepage "https://github.com/LodeKennes/deepseek-harness-desktop"

  livecheck do
    url :homepage
    regex(/desktop-v?(\d+(?:\.\d+)+-rc\.\d+-build-\d+)/i)
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
