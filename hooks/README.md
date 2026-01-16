# SafeShell Hooks

This directory contains hook scripts that integrate SafeShell with external tools and systems.

## Bash Pre-Hook

The bash pre-hook (`bash-prehook.ts`) enables executing bash commands through SafeShell's sandboxed TypeScript runtime. It transpiles bash syntax to TypeScript and executes it using desh.

### What it Does

1. **Receives** bash commands (via stdin or arguments)
2. **Transpiles** bash syntax to TypeScript using SafeShell's transpiler2
3. **Executes** the TypeScript code in a sandboxed Deno runtime via desh
4. **Returns** output with proper exit codes, stdout/stderr separation

### Use Cases

- **Claude Code Integration**: Acts as a pre-hook for the bash tool, allowing Claude Code to execute bash commands through SafeShell's security model
- **Bash-to-SafeShell Bridge**: Allows existing bash scripts to be executed with SafeShell's sandboxing and permission controls
- **Testing**: Validates that bash commands transpile and execute correctly

### Configuration

The hook can be configured via environment variables:

#### `BASH_PREHOOK_MODE`

Execution mode: `streaming` (default) or `buffered`

- **streaming**: Output appears in real-time as it's generated (default, better for interactive use)
- **buffered**: Collects all output and returns it after completion (better for capturing full output)

```bash
BASH_PREHOOK_MODE=buffered ./hooks/bash-prehook.ts "ls -la"
```

#### `BASH_PREHOOK_DEBUG`

Enable debug logging to stderr. Set to `1` to enable.

```bash
BASH_PREHOOK_DEBUG=1 ./hooks/bash-prehook.ts "echo hello"
```

Output:
```
[bash-prehook] Command from args: echo hello
[bash-prehook] Working directory: /Users/jc/dev/safesh
[bash-prehook] Config loaded. ProjectDir: /Users/jc/dev/safesh
[bash-prehook] Transpiling bash command: echo hello
[bash-prehook] Transpiled successfully. Background: false
[bash-prehook] Generated code:
import { $ } from "../src/mod.ts";
(async () => {
  await $`echo hello`;
})();
[bash-prehook] Executing in streaming mode
[bash-prehook] Streaming execution completed with exit code: 0
```

#### `BASH_PREHOOK_CWD`

Override working directory for execution.

```bash
BASH_PREHOOK_CWD=/tmp ./hooks/bash-prehook.ts "pwd"
```

#### `CLAUDE_PROJECT_DIR`

Project directory for SafeShell config (automatically set by Claude Code).

### Usage Examples

#### Execute command via stdin (pipe)

```bash
echo "ls -la | grep .ts" | ./hooks/bash-prehook.ts
```

#### Execute command via argument

```bash
./hooks/bash-prehook.ts "echo hello && pwd"
```

#### Multiple commands

```bash
./hooks/bash-prehook.ts "echo 'Starting...' && ls -la && echo 'Done'"
```

#### With pipes and redirection

```bash
./hooks/bash-prehook.ts "cat package.json | grep name"
```

#### Background execution

```bash
./hooks/bash-prehook.ts "sleep 5 &"
```

### Integration with Claude Code

To use this hook with Claude Code's bash tool:

1. **Configure the hook path** in Claude Code settings
2. **Set hook mode** to `pre` (executes before standard bash)
3. **Enable passthrough** if you want fallback to standard bash on errors

Example configuration:

```json
{
  "tools": {
    "bash": {
      "preHook": "/path/to/safesh/hooks/bash-prehook.ts",
      "hookTimeout": 120000,
      "fallbackOnError": true
    }
  }
}
```

### Testing the Hook

#### Basic functionality

```bash
# Test simple command
./hooks/bash-prehook.ts "echo hello"

# Test with exit code
./hooks/bash-prehook.ts "exit 42"
echo $?  # Should print 42

# Test with stderr
./hooks/bash-prehook.ts "echo error >&2"

# Test piping
./hooks/bash-prehook.ts "echo hello | tr 'a-z' 'A-Z'"
```

#### Debug mode testing

```bash
# See what's happening under the hood
BASH_PREHOOK_DEBUG=1 ./hooks/bash-prehook.ts "ls -la | head -5"
```

#### Mode comparison

```bash
# Streaming (default) - see output as it appears
time ./hooks/bash-prehook.ts "for i in {1..5}; do echo \$i; sleep 0.5; done"

# Buffered - see all output at once
time BASH_PREHOOK_MODE=buffered ./hooks/bash-prehook.ts "for i in {1..5}; do echo \$i; sleep 0.5; done"
```

### Error Handling

The hook handles several error scenarios:

1. **Transpilation errors**: Invalid bash syntax results in clear error messages
2. **Permission errors**: SafeShell's sandbox blocks unauthorized operations
3. **Command not found**: Reports missing commands clearly
4. **Timeout**: Respects SafeShell's timeout configuration

Examples:

```bash
# Invalid syntax
./hooks/bash-prehook.ts "if then fi"
# Error: Failed to transpile bash command: ...

# Blocked command (if not in allowed list)
./hooks/bash-prehook.ts "rm -rf /"
# Permission error with context

# Empty command
./hooks/bash-prehook.ts ""
# Error: Empty bash command provided
```

### Exit Codes

The hook preserves exit codes from executed commands:

- `0`: Success
- `1`: General error (transpilation failure, execution error, etc.)
- `N`: Exit code from the executed bash command (preserved)

### Limitations

1. **Interactive commands**: Not supported (no TTY allocation)
2. **Complex bash features**: Some advanced bash features may not transpile (see transpiler2 docs)
3. **Subshells**: Limited support for complex subshell interactions
4. **Job control**: Background jobs have limited support

### Security Model

The hook enforces SafeShell's security model:

- **Sandboxed execution**: All commands run in Deno's permission-controlled runtime
- **Path restrictions**: File access limited to configured paths
- **Network control**: Network access controlled by SafeShell config
- **Command allowlist**: Only configured external commands can be executed

See SafeShell's main documentation for details on configuring permissions.

### Troubleshooting

#### Hook doesn't execute

- Check that the file is executable: `chmod +x hooks/bash-prehook.ts`
- Verify the shebang is correct (requires Deno)
- Check Deno is installed: `deno --version`

#### Permission denied errors

- Review SafeShell config (`safesh.config.ts`)
- Check `projectDir` is set correctly
- Enable debug mode to see effective permissions: `BASH_PREHOOK_DEBUG=1`

#### Transpilation errors

- Verify bash syntax is valid: `bash -n "your command"`
- Check transpiler2 compatibility (some bash features may not be supported)
- Try simpler commands to isolate the issue

#### Output not appearing

- Check if using buffered mode (waits for completion)
- Verify stdout/stderr are not being captured by another process
- Try with debug mode to see execution flow

### Performance

The hook introduces minimal overhead:

- **Transpilation**: ~1-10ms for typical commands
- **Startup**: ~50-100ms (Deno runtime initialization)
- **Execution**: Same as native desh execution

For long-running commands, the overhead is negligible.

### Related Files

- `/src/bash/transpiler2/mod.ts` - Bash to TypeScript transpiler
- `/src/cli/desh.ts` - Deno shell CLI
- `/src/runtime/executor.ts` - Code execution engine
- `/src/bash/mod.ts` - `parseShellCommand` function

### Contributing

When modifying the hook:

1. Test with various bash commands (simple, complex, pipes, redirections)
2. Test both streaming and buffered modes
3. Verify exit codes are preserved
4. Check stderr separation works correctly
5. Test with Claude Code integration if applicable
