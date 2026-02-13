# Quick script to ensure Node 20.18.0 is active
# Run: . .\ensure-node-20.ps1

Write-Host "🔧 Ensuring Node 20.18.0 is active..." -ForegroundColor Cyan

# Fix PATH - ensure nvm symlink is first
$nvmSymlink = "C:\Users\risha\AppData\Local\nodejs"
$conflictingPath = "C:\nvm4w\nodejs"
$pathEntries = $env:PATH -split ';'

# Always put nvm symlink first and remove conflicting path
$newPath = @($nvmSymlink)
$newPath += $pathEntries | Where-Object { $_ -ne $nvmSymlink -and $_ -ne $conflictingPath }
$env:PATH = $newPath -join ';'

# Verify current version
$currentVersion = node --version 2>&1
Write-Host "Current Node version: $currentVersion" -ForegroundColor Yellow

if ($currentVersion -like "*20.18.0*") {
    Write-Host "✅ Node 20.18.0 is already active!" -ForegroundColor Green
} else {
    Write-Host "Switching to Node 20.18.0..." -ForegroundColor Yellow
    # Use nvm to switch
    $nvmPath = "C:\Users\risha\AppData\Local\nvm\nvm.exe"
    $nvmDir = "C:\Users\risha\AppData\Local\nvm"
    if (Test-Path $nvmPath) {
        $env:NVM_HOME = $nvmDir
        $env:NVM_SYMLINK = $nvmSymlink
        & cmd /c "cd /d `"$nvmDir`" && `"$nvmPath`" use 20.18.0" 2>&1 | Out-Null
        
        # Fix PATH again after nvm use
        $pathEntries = $env:PATH -split ';'
        $newPath = @($nvmSymlink)
        $newPath += $pathEntries | Where-Object { $_ -ne $nvmSymlink -and $_ -ne $conflictingPath }
        $env:PATH = $newPath -join ';'
    }
    
    $finalVersion = node --version 2>&1
    if ($finalVersion -like "*20.18.0*") {
        Write-Host "✅ Successfully switched to Node 20.18.0!" -ForegroundColor Green
    } else {
        Write-Host "⚠️  Still showing: $finalVersion" -ForegroundColor Red
        Write-Host "   Node executable: $((Get-Command node).Source)" -ForegroundColor Yellow
    }
}

Write-Host "`nNode: $(node --version)" -ForegroundColor Cyan
Write-Host "npm:  $(npm --version)" -ForegroundColor Cyan
