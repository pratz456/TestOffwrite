# PowerShell profile script to fix nvm-windows PATH ordering
# Add this to your PowerShell profile: . "C:\WriteOFF\Stripe\WriteOffAppWebsite\fix-nvm-path.ps1"

$nvmSymlink = "C:\Users\risha\AppData\Local\nodejs"
$conflictingPath = "C:\nvm4w\nodejs"

# Check if nvm symlink exists and conflicting path is in PATH
if (Test-Path $nvmSymlink) {
    $pathEntries = $env:PATH -split ';'
    $nvmSymlinkIndex = [array]::IndexOf($pathEntries, $nvmSymlink)
    $conflictingIndex = [array]::IndexOf($pathEntries, $conflictingPath)
    
    # If conflicting path exists and comes before nvm symlink, fix the order
    if ($conflictingIndex -ge 0 -and $nvmSymlinkIndex -ge 0 -and $conflictingIndex -lt $nvmSymlinkIndex) {
        # Reorder PATH to put nvm symlink first, remove conflicting path
        $newPath = @($nvmSymlink)
        $newPath += $pathEntries | Where-Object { $_ -ne $nvmSymlink -and $_ -ne $conflictingPath }
        $env:PATH = $newPath -join ';'
        
        # Auto-switch to version in .nvmrc if it exists
        if (Test-Path ".nvmrc") {
            $nvmrcVersion = (Get-Content ".nvmrc" -Raw).Trim()
            nvm use $nvmrcVersion 2>&1 | Out-Null
        }
    }
}
