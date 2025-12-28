---
name: safesh-permission
description: Handle project command permissions for safesh init()
allowed-tools: Read, Edit, Write
---

# SafeShell Project Command Permissions

When using safesh to run project-local commands (scripts, binaries under the project directory), you must use `init()` to register them. This requires the commands to be in `.claude/safesh.local.ts`.

## Two Types of Commands

### 1. Built-in Commands (No init needed)
```typescript
// These work without any setup
await git("status").exec();
await deno("test").exec();
await docker("ps").exec();
```

### 2. Project Commands (Require init)
```typescript
// Must register project commands first
const commands = init({
  fyngram: "./packages/fyngram/fyngram",
  build: "./scripts/build.sh"
});

await commands.fyngram.exec(["build"]);
await commands.build.exec(["--release"]);
```

## Permission Workflow

**BEFORE** writing code with `init()`:

1. Check `.claude/safesh.local.ts` for allowed project commands
2. If command is NOT listed, prompt user for permission
3. If approved, update the config file
4. THEN write the code using `init()`

## Checking Permissions

Read the project's config file:

```
.claude/safesh.local.ts
```

Look for project commands (those with `name` and `path`):

```typescript
export default {
  allowedCommands: [
    // Built-in command overrides
    "cargo",

    // Project commands (required for init())
    { name: "fyngram", path: "./packages/fyngram/fyngram" },
    { name: "build", path: "./scripts/build.sh" }
  ]
};
```

## Prompting the User

When you need to use a project command not in the config:

```
I need to use './scripts/deploy.sh' as a project command.
Would you like me to add it to .claude/safesh.local.ts?
- Yes: Add and proceed
- No: Cancel
```

## Updating the Config

**If file doesn't exist**, create `.claude/safesh.local.ts`:

```typescript
export default {
  allowedCommands: [
    { name: "deploy", path: "./scripts/deploy.sh" }
  ]
};
```

**If file exists**, add to the array:

```typescript
export default {
  allowedCommands: [
    "cargo",
    { name: "build", path: "./scripts/build.sh" },
    { name: "deploy", path: "./scripts/deploy.sh" }  // added
  ]
};
```

## Using init()

After the config is updated:

```typescript
const commands = init({
  deploy: "./scripts/deploy.sh"
});

// Execute with arguments
await commands.deploy.exec(["--production"]);

// Stream output
for await (const chunk of commands.deploy.stream(["--verbose"])) {
  console.log(chunk);
}

// Use in pipeline
const result = await commands.deploy.cmd(["--json"])
  .pipe("jq", [".status"])
  .exec();
```

## Important Notes

- `init()` checks permissions at registration time, not execution time
- All commands in `init()` must be in the config, or it throws immediately
- This prevents partial script execution when a command is blocked
- Project commands are relative to the project directory
- Commands outside the project/workspace are blocked (require manual system config)
