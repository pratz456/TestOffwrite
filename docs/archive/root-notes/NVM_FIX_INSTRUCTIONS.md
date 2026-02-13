# nvm-windows Node Version Switching Fix

## Problem Identified

The `nvm use 20.18.0` command works correctly, but `node --version` still shows v22.14.0 because of PATH ordering issues.

### Root Cause

1. **Multiple Node installations in PATH:**
   - `C:\nvm4w\nodejs` (contains Node v22.14.0) - appears first in PATH
   - `C:\Users\risha\AppData\Local\nodejs` (nvm-windows symlink to v20.18.0) - appears later in PATH

2. **PATH Order Issue:** Windows finds `C:\nvm4w\nodejs\node.exe` first, so it uses Node v22.14.0 even though the nvm symlink correctly points to v20.18.0.

## Solution

### Option 1: Remove C:\nvm4w\nodejs from System PATH (Recommended)

1. Open **System Properties** → **Environment Variables**
2. Find `C:\nvm4w\nodejs` in the **System PATH** or **User PATH**
3. Remove it (you don't need it since nvm-windows uses `C:\Users\risha\AppData\Local\nodejs`)
4. Restart your terminal
5. Run `nvm use 20.18.0`
6. Verify with `node --version`

### Option 2: Use PowerShell Profile (Temporary Fix Per Session)

A PowerShell profile script has been created that will fix the PATH order each time you open a new terminal. To use it:

1. Check if you have a PowerShell profile:
   ```powershell
   Test-Path $PROFILE
   ```

2. If it returns `False`, create it:
   ```powershell
   New-Item -Path $PROFILE -Type File -Force
   ```

3. Add this line to your PowerShell profile:
   ```powershell
   . "C:\WriteOFF\Stripe\WriteOffAppWebsite\fix-nvm-path.ps1"
   ```

### Option 3: Manual PATH Fix (Per Session)

Run this command in each new PowerShell session:
```powershell
$env:PATH = "C:\Users\risha\AppData\Local\nodejs;" + ($env:PATH -split ';' | Where-Object { $_ -ne 'C:\Users\risha\AppData\Local\nodejs' -and $_ -ne 'C:\nvm4w\nodejs' }) -join ';'
```

Then run:
```powershell
nvm use 20.18.0
node --version  # Should show v20.18.0
```

## Files Created

1. **`.nvmrc`** - Contains `20.18.0` for automatic version switching
   - Use `nvm use` (without version) to automatically switch to the version in this file

2. **`fix-nvm-switching.ps1`** - Diagnostic and fix script
   - Run this script to diagnose and attempt to fix the issue

3. **`fix-nvm-path.ps1`** - PowerShell profile script (see below)

## Verification

After applying the fix:
```powershell
node --version  # Should show v20.18.0
npm --version   # Should work correctly
nvm list        # Should show * 20.18.0 as currently using
```

## Notes

- The `.nvmrc` file has been created in the project root
- Node 20.18.0 is correctly installed via nvm-windows
- The nvm symlink is correctly pointing to v20.18.0
- The only issue is PATH ordering, which needs to be fixed permanently
