# Fix nvm-windows Node version switching issue
# This script resolves the conflict between standalone Node installation and nvm-windows

Write-Host "=== nvm-windows Node Version Switching Fix ===" -ForegroundColor Cyan
Write-Host ""

# Check if running as administrator
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Write-Host "WARNING: This script may require administrator privileges to fix the symlink." -ForegroundColor Yellow
    Write-Host "If the fix doesn't work, please run PowerShell as Administrator and try again." -ForegroundColor Yellow
    Write-Host ""
}

# Check current state
Write-Host "Current Node version:" -ForegroundColor Yellow
node --version
Write-Host ""

Write-Host "nvm installed versions:" -ForegroundColor Yellow
nvm list
Write-Host ""

$nvmSymlink = $env:NVM_SYMLINK
$standaloneNodePath = "C:\Users\risha\AppData\Local\nodejs"

Write-Host "NVM_SYMLINK: $nvmSymlink" -ForegroundColor Yellow
Write-Host "Standalone Node path: $standaloneNodePath" -ForegroundColor Yellow
Write-Host ""

# Check PATH order - nvm symlink must come before C:\nvm4w\nodejs
$pathEntries = $env:PATH -split ';'
$nvmSymlinkIndex = [array]::IndexOf($pathEntries, $standaloneNodePath)
$nvm4wIndex = [array]::IndexOf($pathEntries, "C:\nvm4w\nodejs")

if ($nvm4wIndex -ge 0 -and $nvmSymlinkIndex -ge 0 -and $nvm4wIndex -lt $nvmSymlinkIndex) {
    Write-Host "ISSUE FOUND: C:\nvm4w\nodejs appears before nvm symlink in PATH." -ForegroundColor Red
    Write-Host "This causes the wrong Node version to be used." -ForegroundColor Red
    Write-Host ""
    Write-Host "Fixing PATH order..." -ForegroundColor Yellow
    # Reorder PATH to put nvm symlink first
    $newPath = @($standaloneNodePath)
    $newPath += $pathEntries | Where-Object { $_ -ne $standaloneNodePath -and $_ -ne "C:\nvm4w\nodejs" }
    $env:PATH = $newPath -join ';'
    Write-Host "PATH reordered. Current Node version:" -ForegroundColor Green
    node --version
    Write-Host ""
}

# Check if standalone Node directory exists and is not a symlink
if (Test-Path $standaloneNodePath) {
    $item = Get-Item $standaloneNodePath -ErrorAction SilentlyContinue
    if ($item.LinkType -ne "SymbolicLink") {
        Write-Host "ISSUE FOUND: $standaloneNodePath exists as a real directory, not a symlink." -ForegroundColor Red
        Write-Host "This is blocking nvm-windows from creating its symlink." -ForegroundColor Red
        Write-Host ""
        Write-Host "SOLUTION:" -ForegroundColor Green
        Write-Host "1. Backup the standalone Node installation (optional):" -ForegroundColor Cyan
        Write-Host "   Rename-Item '$standaloneNodePath' '$standaloneNodePath.backup'" -ForegroundColor White
        Write-Host ""
        Write-Host "2. Or remove it if you don't need it:" -ForegroundColor Cyan
        Write-Host "   Remove-Item '$standaloneNodePath' -Recurse -Force" -ForegroundColor White
        Write-Host ""
        Write-Host "3. Then run: nvm use 20.18.0" -ForegroundColor Cyan
        Write-Host ""
        
        # Ask user if they want to proceed
        $response = Read-Host "Do you want to backup and remove the standalone Node installation? (Y/N)"
        if ($response -eq 'Y' -or $response -eq 'y') {
            try {
                $backupPath = "$standaloneNodePath.backup"
                if (Test-Path $backupPath) {
                    Write-Host "Backup already exists. Removing old backup..." -ForegroundColor Yellow
                    Remove-Item $backupPath -Recurse -Force -ErrorAction SilentlyContinue
                }
                Write-Host "Backing up standalone Node installation..." -ForegroundColor Yellow
                Rename-Item $standaloneNodePath $backupPath -ErrorAction Stop
                Write-Host "Backup created successfully!" -ForegroundColor Green
                Write-Host ""
                
                Write-Host "Switching to Node 20.18.0..." -ForegroundColor Yellow
                nvm use 20.18.0
                Write-Host ""
                
                Write-Host "Verifying Node version..." -ForegroundColor Yellow
                $nodeVersion = node --version
                if ($nodeVersion -like "*20.18.0*") {
                    Write-Host "SUCCESS! Node version is now: $nodeVersion" -ForegroundColor Green
                } else {
                    Write-Host "WARNING: Node version is still: $nodeVersion" -ForegroundColor Yellow
                    Write-Host "You may need to restart your terminal for the changes to take effect." -ForegroundColor Yellow
                }
            } catch {
                Write-Host "ERROR: Failed to backup/remove directory. You may need administrator privileges." -ForegroundColor Red
                Write-Host "Error: $_" -ForegroundColor Red
                Write-Host ""
                Write-Host "Please run this script as Administrator or manually:" -ForegroundColor Yellow
                Write-Host "1. Rename '$standaloneNodePath' to '$standaloneNodePath.backup'" -ForegroundColor White
                Write-Host "2. Run: nvm use 20.18.0" -ForegroundColor White
            }
        } else {
            Write-Host "Skipped. Please manually fix the issue as described above." -ForegroundColor Yellow
        }
    } else {
        Write-Host "The directory is already a symlink. Trying to switch versions..." -ForegroundColor Green
        nvm use 20.18.0
        Write-Host ""
        $nodeVersion = node --version
        Write-Host "Current Node version: $nodeVersion" -ForegroundColor Cyan
    }
} else {
    Write-Host "No standalone Node installation found. Switching to Node 20.18.0..." -ForegroundColor Green
    nvm use 20.18.0
    Write-Host ""
    $nodeVersion = node --version
    Write-Host "Current Node version: $nodeVersion" -ForegroundColor Cyan
}

Write-Host ""
Write-Host "=== Fix Complete ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "Note: If the version didn't change, try:" -ForegroundColor Yellow
Write-Host "1. Closing and reopening your terminal" -ForegroundColor White
Write-Host "2. Running: nvm use 20.18.0" -ForegroundColor White
Write-Host "3. Verifying with: node --version" -ForegroundColor White
