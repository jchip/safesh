# SafeShell MCP Usage Guide

## Overview

SafeShell is a sandboxed TypeScript/JavaScript execution environment available as an MCP server. Use it instead of bash for file operations, text processing, and command execution.

## MCP Tools

| Tool | Description |
|------|-------------|
| `run` | Execute code (primary tool) |
| `startShell` | Create persistent shell for state |
| `endShell` | End a shell session |
| `listShells` | List active shells |
| `listScripts` | List script executions |
| `getScriptOutput` | Get output from script |
| `waitScript` | Wait for background script |
| `killScript` | Kill running script |

## Quick Reference

### Fluent $ API (Primary)

```typescript
// Read and process files
await $('file.txt').lines().grep(/pattern/).head(10).print();
await $('file.txt').lines().grep(/ERROR/).collect();
await $('data.txt').lines().map(l => l.toUpperCase()).save('out.txt');

// From arrays/text
await $.from(['a', 'b', 'c']).grep(/a/).collect();
await $.text('line1\nline2').lines().collect();

// Terminal operations
.print()      // output to stdout
.save(path)   // write to file
.collect()    // return array
.first()      // get first item
.count()      // count items
.forEach(fn)  // iterate
```

### Commands

```typescript
// Execute commands
await cmd('ls', ['-la']).exec();
await git('status').exec();
await deno('test').exec();

// Pipe commands
await cmd('echo', ['data']).pipe('grep', ['pattern']).exec();

// Stream output
await git('log', '--oneline').stdout().pipe(lines()).collect();
```

### File Operations

```typescript
// Read/write
const content = await fs.read('file.txt');
await fs.write('file.txt', content);

// JSON
const data = await fs.readJson('config.json');
await fs.writeJson('data.json', { key: 'value' });

// Check/copy/remove
await fs.exists('file.txt');
await fs.copy('src.txt', 'dst.txt');
await fs.remove('file.txt');
```

### Shell State

```typescript
// Variables persist across run calls within same shell
$shell.vars.counter = 42;
$shell.vars.data = { key: 'value' };

// Access shell context
console.log($shell.id);   // shell ID
console.log($shell.cwd);  // working directory
console.log($shell.env);  // environment
```

### ShellJS Commands

```typescript
pwd()                    // current directory
await which('git')       // find command
await test('-f', 'file') // test file exists
await test('-d', 'dir')  // test dir exists
echo('message')          // print message
```

## Common Patterns

### Analyze Log Files

```typescript
// Count errors
const count = await $('app.log').lines().grep(/ERROR/).count();

// Get first 10 errors
const errors = await $('app.log').lines().grep(/ERROR/).head(10).collect();

// Find unique error types
const types = new Set();
await $('app.log').lines().grep(/ERROR/).forEach(line => {
  const match = line.match(/ERROR: (\w+)/);
  if (match) types.add(match[1]);
});
console.log([...types]);
```

### Search Codebase

```typescript
// Find TODOs
await $('src/file.ts').lines().grep(/TODO/).print();

// Count lines of code
const loc = await glob('src/**/*.ts')
  .pipe(filter(f => !f.path.includes('.test.')))
  .pipe(flatMap(f => cat(f.path).pipe(lines())))
  .count();
```

### Git Operations

```typescript
// Status
const status = await git('status', '--short').exec();
console.log(status.stdout);

// Recent commits
const commits = await git('log', '--oneline', '-10').exec();
console.log(commits.stdout);

// Find fix commits
const fixes = await git('log', '--oneline')
  .stdout()
  .pipe(lines())
  .pipe(grep(/fix:/i))
  .collect();
```

### Background Tasks

```typescript
// Run in background
{ "code": "...", "background": true }

// Check script status
listScripts({ shellId, filter: { status: 'running' } })

// Wait for completion
waitScript({ shellId, scriptId, timeout: 30000 })
```

## Best Practices

1. **Use $ API first** - simpler syntax for file/text processing
2. **Use shells for state** - create shell when you need persistent vars
3. **Prefer collect() over forEach()** - easier to work with results
4. **Use grep() for filtering** - supports regex and string patterns
5. **Chain transforms** - `.lines().grep().head().map()` reads naturally

## Auto-imported (no imports needed)

- `$`, `$.from`, `$.text`, `$.wrap`
- `fs.*`, `text.*`
- `cmd`, `git`, `docker`, `deno`
- `glob`, `src`, `cat`, `dest`
- `filter`, `map`, `flatMap`, `lines`, `grep`, `head`, `tail`, `take`
- `stdout`, `stderr`, `tee`
- `createStream`, `fromArray`, `empty`
- `pwd`, `which`, `test`, `echo`, `cd`, `env`
- `$shell`
