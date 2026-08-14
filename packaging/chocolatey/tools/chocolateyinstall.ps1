$ErrorActionPreference = 'Stop'
$packageArgs = @{
  packageName    = 'deepseek-harness'
  fileType       = 'exe'
  silentArgs     = '/S'
  validExitCodes = @(0)
  url64bit       = 'https://github.com/LodeKennes/deepseek-harness-desktop/releases/download/desktop-v0.1.0-6/DeepSeek-Harness-0.1.0-6-win-x64.exe'
  checksum64     = '50a9c6a9ff10064ebe82629d18e0cf818292be6593f3a3a3acebfffd6ce10ef9'
  checksumType64 = 'sha256'
}
Install-ChocolateyPackage @packageArgs
