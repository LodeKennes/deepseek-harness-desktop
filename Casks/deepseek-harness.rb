cask "deepseek-harness" do
  arch arm: "arm64", intel: "x64"

  version "0.1.2-rc.1-build-12"
  sha256 arm:   "1d4eabd98f58161ac43166120becfa55af6e16bab2c586e197f2a0a7d007c9fc",
         intel: "c2f1546fbe75fdf33a34df878d9e2e3cf25270f95206ab517eee05dac05ed84f"

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
