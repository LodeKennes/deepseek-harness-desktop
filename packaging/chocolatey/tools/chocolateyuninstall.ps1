$ErrorActionPreference = 'Stop'
$packageArgs = @{
  packageName    = 'deepseek-harness'
  fileType       = 'exe'
  silentArgs     = '/S'
  validExitCodes = @(0)
}
[array]$key = Get-UninstallRegistryKey -SoftwareName 'DeepSeek Harness*'
if ($key.Count -eq 1) {
  $packageArgs['file'] = $key[0].UninstallString
  Uninstall-ChocolateyPackage @packageArgs
} elseif ($key.Count -gt 1) {
  throw 'More than one DeepSeek Harness uninstall registry key was found.'
}
