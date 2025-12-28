---
name: safesh-permission
description: Handle safesh COMMAND_NOT_ALLOWED errors by prompting user and updating project config
allowed-tools: Read, Edit, Write
---

# SafeShell Permission Workflow

When using the safesh MCP server and a command is blocked due to permissions, follow this workflow to get user approval and update the project config.

## Recognizing Permission Errors

When safesh returns an error with `type: "COMMAND_NOT_ALLOWED"`:

```json
{
  "error": {
    "type": "COMMAND_NOT_ALLOWED",
    "command": "cargo",
    "message": "Command 'cargo' is not in the allowed list"
  }
}
```

## Workflow

### 1. Prompt the User

Ask the user for permission to allow the command:

```
The command 'cargo' is not allowed in safesh.
Would you like to add it to the project's allowed commands?
- Yes: Add to .claude/safesh.local.ts (persists for this project)
- No: Cancel the operation
```

### 2. If User Approves

Edit or create `.claude/safesh.local.ts` in the project root:

**If file doesn't exist**, create it:

```typescript
export default {
  allowedCommands: ["cargo"]
};
```

**If file exists**, add the command to the array:

```typescript
export default {
  allowedCommands: ["cargo", "rustc", "NEW_COMMAND"]
};
```

### 3. Retry the Operation

After updating the config, retry the original safesh operation. The command should now be allowed.

**Using retry_id (if available):**

If the error includes a `retry_id`, you can use it for a faster retry:

```typescript
// Original call returned:
// { error: { type: "COMMAND_NOT_ALLOWED", command: "cargo" }, retry_id: "abc123" }

// After updating config, retry with:
safesh.run({ retry_id: "abc123" })
```

The retry will use the same code and context as the original call.

## Config File Format

The `.claude/safesh.local.ts` file supports:

```typescript
export default {
  allowedCommands: [
    // Simple string - allows command with any args
    "cargo",
    "deno",

    // Object - granular control
    {
      command: "git",
      subcommands: ["status", "log", "diff", "add", "commit"],
      flags: ["--verbose", "-v"]
    }
  ]
};
```

## Important Notes

- Only commands within the project workspace can be allowed via this config
- System-level commands (outside workspace) require manual user configuration in `~/.config/safesh/config.ts`
- The `.claude/` directory is typically gitignored, so permissions are local to each developer
- Always inform the user what command is being added before modifying the config
