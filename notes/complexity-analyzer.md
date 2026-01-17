# Bash Complexity Analyzer

## Overview

The bash-prehook now includes a complexity analyzer that determines whether a bash command needs transpilation or can execute directly with native bash.

## Decision Logic

```
Parse bash → Analyze AST → Check permissions
                                    ↓
                    ┌───────────────┴────────────────┐
                    │                                 │
             Simple + Allowed                  Complex or Blocked
                    ↓                                 ↓
          Passthrough to bash              Transpile to TypeScript
          (no script file)                  (cached script file)
```

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
- Simple commands execute directly (faster startup, no Deno overhead)
- Complex commands still benefit from SafeShell's sandboxing

### Disk I/O
- No script files created for simple commands
- Fewer files in `/tmp/safesh/scripts/`
- Reduced cleanup overhead

### Security
- Permission checks happen before passthrough decision
- Blocked commands still require user approval
- Complex commands maintain full error handling

## Examples

### Passthrough Examples

```bash
# Simple command
echo "Hello World"

# Pipeline with operators
git status && git diff | head -20

# Redirect
echo "data" > output.txt

# Script execution
./my-script.sh
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
