# Bash Complexity Analyzer

## Overview

The bash-prehook now includes a complexity analyzer that determines whether a bash command needs transpilation or can execute directly with native bash.

## Decision Logic

```
Parse bash → Analyze AST complexity
                    ↓
        ┌───────────┴────────────┐
        │                        │
     Simple                   Complex
        ↓                        ↓
  Passthrough to bash     Transpile to TypeScript
  (Bash tool handles       (SafeShell handles
   permissions)             permissions)
```

**Key insight**: Simple commands don't need SafeShell's sandboxing. They can execute directly with native bash, and Claude Code's Bash tool will handle any permission prompts. Only complex commands require transpilation and SafeShell's runtime.

## Command Classification

### Simple Commands (Native Bash)

Commands that can execute directly without transpilation:

- **Basic commands**: `ls -la`, `echo hello`, `cat file.txt`
- **Pipelines**: `ls | grep foo`, `echo a && echo b`, `cmd1 || cmd2`
- **Simple redirects**: `echo foo > file.txt`, `cat < input.txt`, `cmd 2>&1`
- **Variable assignments**: `FOO=bar`, `export PATH=/usr/bin`
- **Test commands**: `[[ -f file.txt ]]`, `(( x > 5 ))`

**Note**: Heredocs are treated as complex and require transpilation.

### Complex Commands (Transpiled)

Commands that require TypeScript transpilation:

- **Loops**: `for`, `while`, `until`
- **Conditionals**: `if`, `case`
- **Functions**: `function foo() { ... }`
- **Subshells**: `(cd /tmp && ls)`
- **Brace groups**: `{ echo a; echo b; }`
- **Command substitutions**: `echo $(pwd)`, `` echo `date` ``
- **Process substitutions**: `diff <(cmd1) <(cmd2)`
- **Heredocs**: `cat <<EOF`, `cat <<-EOF`, `cat <<<"string"`

## Benefits

### Performance
- Simple commands execute with native bash (zero overhead)
- No parsing, transpiling, or Deno startup for simple commands
- Complex commands still benefit from SafeShell's TypeScript runtime

### Disk I/O
- No script files created for simple commands
- Only complex commands create cached files in `/tmp/safesh/scripts/`
- Minimal disk footprint

### Permission Handling
- Simple commands: Claude Code's Bash tool handles permissions naturally
- Complex commands: SafeShell's permission system (since they need transpilation anyway)
- Cleaner separation of concerns

## Examples

### Passthrough Examples

These execute with native bash, regardless of permissions:

```bash
# Simple command
echo "Hello World"

# Pipeline with operators
git status && git diff | head -20

# Redirect
echo "data" > output.txt

# Script execution
./my-script.sh

# Even "blocked" commands passthrough (Bash tool handles permission)
chmod +x script.sh
```

### Transpiled Examples

```bash
# Loop
for i in {1..10}; do echo $i; done

# Command substitution
echo "Current dir: $(pwd)"

# Conditional
if [[ -f file.txt ]]; then cat file.txt; fi

# Subshell
(cd /tmp && ls -la)

# Heredoc
cat <<EOF
line 1
line 2
EOF
```

## Implementation

The analyzer uses the bash parser's AST to detect:

1. **Statement types** - Loops, conditionals, functions trigger transpilation
2. **Command expansions** - Command substitutions `$(...)` and process substitutions `<(...)`
3. **Subshells and groups** - `(...)` and `{...}` require transpilation

See `hooks/bash-prehook.ts` functions:
- `isSimpleCommand(ast)` - Main entry point
- `isSimpleStatement(stmt)` - Checks individual statements
- `hasComplexExpansions(cmd)` - Detects command/process substitutions
