# Testing the Auto-Open Response Files Setting

## Test Cases

### Case 1: Setting Enabled (Default)
1. Ensure `netconf.autoOpenResponses` is set to `true` (default)
2. Connect to a NETCONF server
3. Send a `get-config` command
4. **Expected**: Response should automatically open in a new file tab

### Case 2: Setting Disabled
1. Set `netconf.autoOpenResponses` to `false` in VS Code settings
2. Connect to a NETCONF server
3. Send a `get-config` command
4. **Expected**: Response should NOT automatically open a new file tab
5. Check the output channel for the logged response

### Case 3: User-Initiated Actions (Should Always Open)
Even with setting disabled:
1. Click "Open" when prompted after an RPC error
2. Click "Open" when prompted after a successful connection hello message
3. Manually send a custom RPC from the editor
4. View event notifications
5. **Expected**: All these should still open files (force open behavior)

## Implementation Details

- The `showXmlDocument` function now accepts a `forceOpen` parameter
- When `forceOpen` is `true`, files open regardless of the setting
- When `forceOpen` is `false` (default), the setting is respected
- All user-initiated actions use `forceOpen: true`
- Automatic RPC responses use the default behavior (respects setting)

## Settings Location

Go to VS Code Settings and search for "netconf" to find:
- **NETCONF: Auto-open Response Files** - Controls automatic file opening