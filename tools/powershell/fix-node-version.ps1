# Quick fix script to switch to Node 22.23.2
# Run this in any terminal: . .\fix-node-version.ps1

Write-Host "🔧 Fixing Node version to 22.23.2..." -ForegroundColor Cyan

# Fix PATH ordering
$nvmSymlink = "C:\Users\risha\AppData\Local\nodejs"
$conflictingPath = "C:\nvm4w\nodejs"
$pathEntries = $env:PATH -split ';'

# Remove conflicting path and ensure nvm symlink is first
$newPath = @($nvmSymlink)
$newPath += $pathEntries | Where-Object { $_ -ne $nvmSymlink -and $_ -ne $conflictingPath }
$env:PATH = $newPath -join ';'

# Switch to Node 22.23.2
$nvmPath = "C:\Users\risha\AppData\Local\nvm\nvm.exe"
$nvmDir = "C:\Users\risha\AppData\Local\nvm"
if (Test-Path $nvmPath) {
    $env:NVM_HOME = $nvmDir
    $env:NVM_SYMLINK = $nvmSymlink
    & cmd /c "cd /d `"$nvmDir`" && `"$nvmPath`" use 22.23.2" 2>&1 | Out-Null
}

# Verify
$nodeVersion = node --version
Write-Host "✅ Node version: $nodeVersion" -ForegroundColor Green

if ($nodeVersion -like "*22.23.2*") {
    Write-Host "✅ Success! Node 22.23.2 is now active." -ForegroundColor Green
} else {
    Write-Host "⚠️  Warning: Node version is still $nodeVersion" -ForegroundColor Yellow
    Write-Host "   Try running: nvm use 22.23.2" -ForegroundColor Yellow
}
