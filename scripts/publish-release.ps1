# Publishes a signed Tauri build as a GitHub Release with the updater manifest (latest.json).
# Usage: powershell -File scripts/publish-release.ps1 -Notes "What's new..."
param([string]$Notes = "Bug fixes and improvements.")
$ErrorActionPreference = "Stop"

$conf    = Get-Content "src-tauri/tauri.conf.json" -Raw | ConvertFrom-Json
$version = $conf.version
$tag     = "v$version"
$repo    = "abazionkiai/HKM-AUDIO-SYSTEM"
$bundle  = "src-tauri/target/release/bundle"
$out     = "release-out/$tag"

New-Item -ItemType Directory -Force -Path $out | Out-Null
$exeName = "Church-Audio-Intelligence_${version}_x64-setup.exe"
$msiName = "Church-Audio-Intelligence_${version}_x64_en-US.msi"
Copy-Item "$bundle/nsis/Church Audio Intelligence_${version}_x64-setup.exe"     "$out/$exeName"
Copy-Item "$bundle/nsis/Church Audio Intelligence_${version}_x64-setup.exe.sig" "$out/$exeName.sig"
Copy-Item "$bundle/msi/Church Audio Intelligence_${version}_x64_en-US.msi"      "$out/$msiName"

$sig  = (Get-Content "$out/$exeName.sig" -Raw).Trim()
$base = "https://github.com/$repo/releases/download/$tag"
$manifest = [ordered]@{
  version  = $version
  notes    = $Notes
  pub_date = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
  platforms = [ordered]@{
    "windows-x86_64" = [ordered]@{ signature = $sig; url = "$base/$exeName" }
  }
}
$json = $manifest | ConvertTo-Json -Depth 5
[System.IO.File]::WriteAllText((Join-Path (Resolve-Path $out) "latest.json"), $json, (New-Object System.Text.UTF8Encoding $false))

gh release create $tag --repo $repo --title "Church Audio Intelligence $tag" --notes $Notes `
  "$out/$exeName" "$out/$exeName.sig" "$out/$msiName" "$out/latest.json"
if ($LASTEXITCODE -ne 0) { throw "gh release create failed (exit $LASTEXITCODE)" }
Write-Host "Published $tag -> https://github.com/$repo/releases/tag/$tag"
