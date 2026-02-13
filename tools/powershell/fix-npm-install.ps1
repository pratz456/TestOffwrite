# Fix npm install issues on Windows
# This script handles permission errors and cleans up before reinstalling

Write-Host "=== Fixing npm install issues ===" -ForegroundColor Cyan

# Step 1: Close any processes that might be locking node_modules
Write-Host "`nStep 1: Checking for processes that might lock files..." -ForegroundColor Yellow
$processes = @("node", "code", "Code", "cursor", "Cursor", "explorer")
$locked = $false

foreach ($proc in $processes) {
    $running = Get-Process -Name $proc -ErrorAction SilentlyContinue
    if ($running) {
        Write-Host "  Warning: $proc is running. You may need to close it manually." -ForegroundColor Yellow
        $locked = $true
    }
}

if ($locked) {
    Write-Host "  Please close any file explorers, VS Code, or other editors before continuing." -ForegroundColor Yellow
    $continue = Read-Host "  Continue anyway? (y/n)"
    if ($continue -ne "y") {
        exit
    }
}

# Step 2: Remove node_modules with retry logic
Write-Host "`nStep 2: Removing node_modules folder..." -ForegroundColor Yellow
if (Test-Path "node_modules") {
    try {
        Remove-Item -Path "node_modules" -Recurse -Force -ErrorAction Stop
        Write-Host "  ✓ node_modules removed successfully" -ForegroundColor Green
    } catch {
        Write-Host "  ⚠ Failed to remove node_modules: $_" -ForegroundColor Red
        Write-Host "  Trying alternative method..." -ForegroundColor Yellow

        # Try with robocopy trick (creates empty dir, then removes)
        $emptyDir = "$env:TEMP\node_modules_empty"
        New-Item -ItemType Directory -Path $emptyDir -Force | Out-Null
        robocopy $emptyDir "node_modules" /MIR /R:0 /W:0 /NFL /NDL /NJH /NJS | Out-Null
        Remove-Item -Path "node_modules" -Recurse -Force -ErrorAction SilentlyContinue
        Remove-Item -Path $emptyDir -Recurse -Force -ErrorAction SilentlyContinue

        if (Test-Path "node_modules") {
            Write-Host "  ✗ Could not remove node_modules. Please close all applications and try again." -ForegroundColor Red
            exit 1
        } else {
            Write-Host "  ✓ node_modules removed using alternative method" -ForegroundColor Green
        }
    }
} else {
    Write-Host "  ✓ node_modules doesn't exist (already clean)" -ForegroundColor Green
}

# Step 3: Clear npm cache
Write-Host "`nStep 3: Clearing npm cache..." -ForegroundColor Yellow
npm cache clean --force
if ($LASTEXITCODE -eq 0) {
    Write-Host "  ✓ npm cache cleared" -ForegroundColor Green
} else {
    Write-Host "  ⚠ npm cache clean had warnings, but continuing..." -ForegroundColor Yellow
}

# Step 4: Check Node version
Write-Host "`nStep 4: Checking Node version..." -ForegroundColor Yellow
$nodeVersion = node --version
Write-Host "  Current Node version: $nodeVersion" -ForegroundColor Cyan

if ($nodeVersion -notmatch "^v20\.") {
    Write-Host "  ⚠ Warning: Project requires Node 20, but you have $nodeVersion" -ForegroundColor Yellow
    Write-Host "  The install may still work, but using Node 20 is recommended." -ForegroundColor Yellow
    Write-Host "  Consider using nvm-windows to switch to Node 20:" -ForegroundColor Yellow
    Write-Host "    nvm install 20" -ForegroundColor Cyan
    Write-Host "    nvm use 20" -ForegroundColor Cyan
    $continue = Read-Host "`n  Continue with current Node version? (y/n)"
    if ($continue -ne "y") {
        exit
    }
}

# Step 5: Remove package-lock.json (optional, but can help)
Write-Host "`nStep 5: Cleaning up package-lock.json..." -ForegroundColor Yellow
if (Test-Path "package-lock.json") {
    $removeLock = Read-Host "  Remove package-lock.json for fresh install? (y/n)"
    if ($removeLock -eq "y") {
        Remove-Item -Path "package-lock.json" -Force
        Write-Host "  ✓ package-lock.json removed" -ForegroundColor Green
    }
}

# Step 6: Run npm install
Write-Host "`nStep 6: Running npm install..." -ForegroundColor Yellow
Write-Host "  This may take several minutes..." -ForegroundColor Cyan
npm install --no-audit

if ($LASTEXITCODE -eq 0) {
    Write-Host "`n✓ npm install completed successfully!" -ForegroundColor Green
} else {
    Write-Host "`n✗ npm install failed. Check the errors above." -ForegroundColor Red
    Write-Host "`nTroubleshooting tips:" -ForegroundColor Yellow
    Write-Host "  1. Run PowerShell as Administrator" -ForegroundColor White
    Write-Host "  2. Close all file explorers and code editors" -ForegroundColor White
    Write-Host "  3. Disable antivirus temporarily" -ForegroundColor White
    Write-Host "  4. Switch to Node 20 using nvm-windows" -ForegroundColor White
    exit 1
}



