$ErrorActionPreference = 'Stop'
$packageArgs = @{
  packageName    = 'deepseek-harness'
  fileType       = 'exe'
  silentArgs     = '/S'
  validExitCodes = @(0)
  url64bit       = 'https://github.com/LodeKennes/deepseek-harness-desktop/releases/download/desktop-v0.1.2-rc.1-build-12/DeepSeek-Harness-0.1.2-rc.1-build-12-win-x64.exe'
  checksum64     = '23bb46817e119186266148af8a4f941648004fd7f47d72b2fbc9eaf8be2fbfeb'
  checksumType64 = 'sha256'
}
Install-ChocolateyPackage @packageArgs
