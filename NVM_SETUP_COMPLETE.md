# nvm Node Version Setup - Complete

## Status: ✅ Configured

Your system is now configured to use Node 20.18.0 for this project.

## What Was Fixed

1. **Created `.nvmrc` file** with `20.18.0`
2. **Fixed PATH ordering** in PowerShell profile to ensure nvm symlink takes precedence
3. **Updated PowerShell profile** to automatically fix PATH on terminal startup

## Current Configuration

- **Project Node Version**: 20.18.0 (specified in `.nvmrc`)
- **package.json engines**: `"node": "20"`
- **PowerShell Profile**: Updated to fix PATH ordering automatically

## How to Use

### In Current Terminal Session

The PATH has been fixed in your current session. Node should show v20.18.0:
```bash
node --version  # Should show v20.18.0
```

### In New Terminal Sessions

When you open a new PowerShell terminal:
1. The profile will automatically fix PATH ordering
2. If you're in a project directory with `.nvmrc`, you can run:
   ```bash
   nvm use
   ```
   This will automatically switch to the version in `.nvmrc` (20.18.0)

### Manual Switch

If you need to manually switch versions:
```bash
nvm use 20.18.0
```

## Verification

To verify everything is working:
```bash
# Check Node version
node --version  # Should show v20.18.0

# Check npm version
npm --version   # Should work correctly

# Check which node is being used
(Get-Command node).Source
# Should show: C:\Users\risha\AppData\Local\nodejs\node.exe
```

## Troubleshooting

If `node --version` still shows v22.14.0 in a new terminal:

1. **Check PATH order:**
   ```powershell
   $env:PATH -split ';' | Select-String -Pattern 'node'
   ```
   The nvm symlink should appear first.

2. **Manually fix PATH:**
   ```powershell
   $nvmSymlink = "C:\Users\risha\AppData\Local\nodejs"
   $conflictingPath = "C:\nvm4w\nodejs"
   $pathEntries = $env:PATH -split ';'
   $newPath = @($nvmSymlink)
   $newPath += $pathEntries | Where-Object { $_ -ne $nvmSymlink -and $_ -ne $conflictingPath }
   $env:PATH = $newPath -join ';'
   node --version
   ```

3. **Reload PowerShell profile:**
   ```powershell
   . $PROFILE
   ```

## Files Modified

- `.nvmrc` - Created with Node version 20.18.0
- `C:\Users\risha\OneDrive\Documents\WindowsPowerShell\Microsoft.PowerShell_profile.ps1` - Updated with PATH fix

## Next Steps

Now that Node 20.18.0 is configured, you can:
- Build your application: `npm run build`
- Deploy to Firebase: `firebase deploy --only hosting`
- The Node 22 warning should be gone during deployment
