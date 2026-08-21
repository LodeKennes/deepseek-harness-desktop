$ErrorActionPreference = 'Stop'
$packageArgs = @{
  packageName    = 'deepseek-harness'
  fileType       = 'exe'
  silentArgs     = '/S'
  validExitCodes = @(0)
  url64bit       = 'https://github.com/LodeKennes/deepseek-harness-desktop/releases/download/desktop-v0.1.1-rc.1-build-11/DeepSeek-Harness-0.1.1-rc.1-build-11-win-x64.exe'
  checksum64     = 'c6cbda57171531d8e1a30dbdb23dbd41db931030d7ec9604e26cba60c061a721'
  checksumType64 = 'sha256'
}
Install-ChocolateyPackage @packageArgs
