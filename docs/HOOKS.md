# Claude Code Hooks Configuration

This document explains how to configure Claude Code to use SafeShell's bash pre-hook for executing bash commands.

## What This Does

When configured, all bash commands that Claude Code generates will be:
1. **Intercepted** by the pre-hook before execution
2. **Transpiled** from bash to TypeScript using SafeShell's transpiler2
3. **Executed** in SafeShell's sandboxed runtime with permission controls
4. **Results** returned to Claude Code (stdout, stderr, exit code)

## Benefits

- **Sandboxed Execution**: All commands run through SafeShell's permission system
- **No Bash Required**: Commands execute even if bash isn't installed
- **Transparent**: Claude Code doesn't need to change - it generates normal bash commands
- **Testable**: Transpiled TypeScript is easier to test and debug
- **Consistent**: Same execution environment across different systems

## Configuration

### Global Configuration

Edit `~/.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "/absolute/path/to/safesh/hooks/bash-prehook.ts"
          }
        ]
      }
    ]
  }
}
```

### Project-Specific Configuration

Create `.claude/settings.json` in your project:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "/Users/jc/dev/safesh/hooks/bash-prehook.ts"
          }
        ]
      }
    ]
  }
}
```

Project settings override global settings.

## Environment Variables

You can customize the hook behavior with environment variables:

### BASH_PREHOOK_DEBUG
Enable debug logging to stderr:
```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "/Users/jc/dev/safesh/hooks/bash-prehook.ts",
            "env": {
              "BASH_PREHOOK_DEBUG": "1"
            }
          }
        ]
      }
    ]
  }
}
```

### BASH_PREHOOK_MODE
Choose execution mode:
- `streaming` (default): Output appears in real-time
- `buffered`: Output appears after command completes

```json
{
  "env": {
    "BASH_PREHOOK_MODE": "buffered"
  }
}
```

### BASH_PREHOOK_CWD
Override working directory:
```json
{
  "env": {
    "BASH_PREHOOK_CWD": "/custom/working/directory"
  }
}
```

## How It Works

### Flow Diagram
```
┌─────────────────┐
│  Claude Code    │
│ generates bash  │
│  "ls -la"       │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  PreToolUse     │
│  Hook Trigger   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ bash-prehook.ts │
│  - Parse bash   │
│  - Transpile    │
│  - Execute      │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ SafeShell       │
│  Runtime        │
│  (sandboxed)    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Results sent   │
│  back to Claude │
│  (stdout/stderr)│
└─────────────────┘
```

### Example

**Claude generates:**
```bash
ls -la | grep .ts
```

**Hook transpiles to:**
```typescript
(async () => {
  const ls = await $.cmd("ls");
  const grep = await $.cmd("grep");
  await ls("-la").pipe(grep, [".ts"]);
})();
```

**Executes in SafeShell runtime with:**
- Permission checks
- Environment isolation
- Path validation

## Testing the Hook

Test the hook manually:

```bash
# Simple command
./hooks/bash-prehook.ts "pwd"

# With arguments
./hooks/bash-prehook.ts "echo hello world"

# Pipeline
./hooks/bash-prehook.ts "ls -la | grep .ts"

# Logical operators
./hooks/bash-prehook.ts "echo foo && echo bar"

# With debug output
BASH_PREHOOK_DEBUG=1 ./hooks/bash-prehook.ts "pwd"
```

## Permissions

The hook uses SafeShell's permission system. Commands must be allowed in `safesh.config.ts`:

```typescript
export default {
  permissions: {
    run: [
      "pwd", "ls", "echo", "cat", // etc.
    ],
  },
};
```

See `safesh.config.ts` documentation for more details.

## Troubleshooting

### Hook not executing
- Check the path in settings.json is absolute
- Ensure bash-prehook.ts is executable: `chmod +x hooks/bash-prehook.ts`
- Check Claude Code restart might be needed after config changes

### Permission errors
- Check `safesh.config.ts` has the command in `permissions.run`
- Enable debug mode to see what's happening: `BASH_PREHOOK_DEBUG=1`

### Commands fail silently
- Enable debug mode to see transpiled code
- Check command syntax is valid bash
- Verify SafeShell runtime has necessary permissions

## Disabling the Hook

To temporarily disable the hook:

**Option 1**: Comment out the hook in settings.json:
```json
{
  "hooks": {
    "PreToolUse": []
  }
}
```

**Option 2**: Replace with a pass-through:
```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": []
      }
    ]
  }
}
```

## Related Files

- `hooks/bash-prehook.ts` - The hook implementation
- `hooks/README.md` - Hook development documentation
- `src/bash/transpiler2/` - Bash to TypeScript transpiler
- `src/runtime/executor.ts` - SafeShell runtime executor

## Support

For issues or questions:
1. Enable debug mode: `BASH_PREHOOK_DEBUG=1`
2. Check transpiled code in debug output
3. Test hook directly: `./hooks/bash-prehook.ts "your command"`
4. File an issue in the safesh repository
