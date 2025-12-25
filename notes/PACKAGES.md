# SafeShell - Deno Packages Reference

This document catalogs packages that work with Deno and are suitable for building SafeShell.

---

## MCP (Model Context Protocol)

### @modelcontextprotocol/sdk (Official)
**Source:** [npm](https://www.npmjs.com/package/@modelcontextprotocol/sdk) | [GitHub](https://github.com/modelcontextprotocol/typescript-sdk)

The official TypeScript SDK for MCP servers and clients. Works with Deno via npm import.

```typescript
import { Server } from "npm:@modelcontextprotocol/sdk/server";
import { StdioServerTransport } from "npm:@modelcontextprotocol/sdk/server/stdio";
```

**Features:**
- Full MCP specification implementation
- Tools, Resources, and Prompts support
- stdio and Streamable HTTP transports
- Requires zod as peer dependency

**Use for:** MCP server implementation (SSH-16, SSH-17, SSH-18)

---

## Deno Standard Library (@std)

All packages available on [JSR](https://jsr.io/@std). Install via:
```bash
deno add jsr:@std/fs jsr:@std/path jsr:@std/streams
```

### @std/fs - File System
**JSR:** https://jsr.io/@std/fs

```typescript
import { walk, expandGlob, ensureDir, copy, move } from "jsr:@std/fs";
```

**Key Functions:**
| Function | Description |
|----------|-------------|
| `walk(root, options)` | Recursively walk directory tree |
| `expandGlob(pattern)` | Match files with glob patterns |
| `ensureDir(path)` | Create directory if not exists |
| `copy(src, dest)` | Copy file or directory |
| `move(src, dest)` | Move/rename file or directory |
| `emptyDir(path)` | Empty a directory |
| `exists(path)` | Check if path exists |

**Use for:** SSH-20 (Stdlib file system utilities)

### @std/path - Path Utilities
**JSR:** https://jsr.io/@std/path

```typescript
import { join, resolve, dirname, basename, extname } from "jsr:@std/path";
import * as posix from "jsr:@std/path/posix";
import * as windows from "jsr:@std/path/windows";
```

**Features:**
- Cross-platform path manipulation
- Automatic OS detection
- Explicit POSIX/Windows modules

**Use for:** Path validation, sandbox checks

### @std/streams - Stream Utilities
**JSR:** https://jsr.io/@std/streams

```typescript
import { toTransformStream, TextLineStream, ByteSliceStream } from "jsr:@std/streams";
```

**Key Functions:**
| Function | Description |
|----------|-------------|
| `toTransformStream(generator)` | Convert generator to TransformStream |
| `TextLineStream` | Split stream by lines |
| `ByteSliceStream` | Slice byte streams |
| `mergeReadableStreams` | Combine multiple streams |

**Use for:** SSH-23, SSH-24, SSH-25 (Streaming API)

### @std/async - Async Utilities
**JSR:** https://jsr.io/@std/async

```typescript
import { delay, debounce, retry, pooledMap, deadline } from "jsr:@std/async";
```

**Key Functions:**
| Function | Description |
|----------|-------------|
| `delay(ms)` | Promise-based delay |
| `debounce(fn, wait)` | Debounce function calls |
| `retry(fn, options)` | Retry with backoff/jitter |
| `pooledMap(limit, iter, fn)` | Concurrent map with pool limit |
| `deadline(promise, ms)` | Timeout for promises |

**Use for:** SSH-27 (Parallel execution), SSH-29 (Watch mode debounce)

### @std/fmt - Formatting
**JSR:** https://jsr.io/@std/fmt

```typescript
import { red, bold, bgBlue, rgb24, stripAnsiCode } from "jsr:@std/fmt/colors";
import { format as formatBytes } from "jsr:@std/fmt/bytes";
import { format as formatDuration } from "jsr:@std/fmt/duration";
```

**Features:**
- ANSI color codes
- Respects NO_COLOR env var
- Byte/duration formatting
- printf-style formatting

**Use for:** CLI output, error messages

### @std/assert - Assertions
**JSR:** https://jsr.io/@std/assert

```typescript
import { assert, assertEquals, assertThrows, assertRejects } from "jsr:@std/assert";
```

**Use for:** Testing, validation

### @std/testing - Testing Utilities
**JSR:** https://jsr.io/@std/testing

```typescript
import { spy, stub, assertSpyCall } from "jsr:@std/testing/mock";
import { describe, it, beforeEach } from "jsr:@std/testing/bdd";
import { assertSnapshot } from "jsr:@std/testing/snapshot";
```

**Features:**
- Mocking/spying
- BDD-style testing
- Snapshot testing

**Use for:** All test files

### @std/dotenv - Environment Variables
**JSR:** https://jsr.io/@std/dotenv (UNSTABLE)

```typescript
import { load, loadSync, parse } from "jsr:@std/dotenv";
// Or auto-load:
import "jsr:@std/dotenv/load";
```

**Features:**
- Parse .env files
- Support for defaults and examples
- Export to process.env

**Use for:** SSH-10 (Config loading)

### @std/tar - Archive (Tar)
**JSR:** https://jsr.io/@std/tar (UNSTABLE)

```typescript
import { Tar, Untar } from "jsr:@std/tar";
```

**Note:** Replaces deprecated `@std/archive`

**Use for:** SSH-30 (Archive utilities)

---

## CLI Argument Parsing

### @std/cli/parse-args (Recommended - Minimal)
**JSR:** https://jsr.io/@std/cli

Simple, no-framework argument parsing. Just parse and get an object.

```typescript
import { parseArgs } from "jsr:@std/cli/parse-args";

const args = parseArgs(Deno.args, {
  string: ["config", "cwd"],
  boolean: ["verbose", "help", "version"],
  alias: { c: "config", v: "verbose", h: "help" },
  default: { verbose: false },
});

// args = { config: "foo.ts", verbose: true, _: ["exec", "code here"] }
console.log(args.config);      // "foo.ts"
console.log(args.verbose);     // true
console.log(args._[0]);        // "exec" (positional)
console.log(args._[1]);        // "code here"
```

**Pros:** Zero bloat, just parsing, no magic
**Cons:** No auto-generated help, no subcommand routing

**Use for:** SSH-32 (CLI entry point) - **RECOMMENDED**

### @cliffy/flags (Alternative - Slightly More)
**JSR:** https://jsr.io/@cliffy/flags

Better type inference than @std/cli, still just parsing.

```typescript
import { parseFlags } from "jsr:@cliffy/flags";

const { flags, unknown, literal } = parseFlags(Deno.args, {
  flags: [{
    name: "config",
    aliases: ["c"],
    type: "string",
  }, {
    name: "verbose",
    aliases: ["v"],
    type: "boolean",
  }],
});
```

### @cliffy/command (Full Framework - If Needed)
**JSR:** https://jsr.io/@cliffy/command | [Docs](https://cliffy.io)

Full CLI framework with auto-help. **Explicit definition, NOT file-based discovery.**

```typescript
import { Command } from "jsr:@cliffy/command";

await new Command()
  .name("safesh")
  .version("1.0.0")
  .option("-c, --config <file:string>", "Config file")
  .option("-v, --verbose", "Verbose output")
  .arguments("<action:string> [code:string]")
  .action((options, action, code) => {
    // All explicit, no magic file scanning
  })
  .parse(Deno.args);
```

**Cliffy Modules (all separate, pick what you need):**
| Module | What it does |
|--------|--------------|
| `@cliffy/flags` | Just arg parsing |
| `@cliffy/command` | Fluent command builder + auto help |
| `@cliffy/prompt` | Interactive prompts (Input, Select) |
| `@cliffy/table` | ASCII table formatting |

**Use for:** Only if you want auto-generated `--help`

---

## Third-Party Libraries

### @zod/zod - Schema Validation
**JSR:** https://jsr.io/@zod/zod | **npm:** zod

```typescript
import { z } from "jsr:@zod/zod";
// or
import { z } from "npm:zod";

const ConfigSchema = z.object({
  permissions: z.object({
    read: z.array(z.string()),
    write: z.array(z.string()),
  }),
});
```

**Features:**
- TypeScript-first validation
- Static type inference
- Required by MCP SDK

**Use for:** SSH-10 (Config validation), SSH-39 (Security presets)

### @deno-library/compress - Archive (Zip)
**JSR:** https://jsr.io/@deno-library/compress

```typescript
import { zip, unzip, gzip, gunzip, tar, untar } from "jsr:@deno-library/compress";
```

**Formats:** tar, gzip, tgz, zip, deflate, brotli

**Use for:** SSH-30 (Archive utilities - zip support)

### @codemonument/rx-webstreams - RxJS-like Streams
**JSR:** https://jsr.io/@codemonument/rx-webstreams

```typescript
import { fileSource, map, reduce, fileTarget } from "jsr:@codemonument/rx-webstreams";
```

**Features:**
- RxJS-inspired API for Web Streams
- Sources: `fileSource()`, `timerSource()`
- Transforms: `map()`, `reduce()`
- Targets: `fileTarget()`, `urlTarget()`

**Use for:** SSH-25 (Stream transforms) - alternative API

---

## Task Runner Libraries

### devo (iAmNathanJ/devo)
**GitHub:** https://github.com/iAmNathanJ/devo

```typescript
import { task, parallel, series } from "https://deno.land/x/devo/mod.ts";

const build = task("build", async () => { /* ... */ });
const test = task("test", async () => { /* ... */ });

await series(build, parallel(lint, test));
```

**Features:**
- `series()` and `parallel()` composition
- Named tasks
- Composable chains

**Use for:** Inspiration for SSH-26, SSH-27, SSH-28

### Built-in: deno task
**Docs:** https://docs.deno.com/runtime/reference/cli/task/

```json
// deno.json
{
  "tasks": {
    "build": "deno compile src/main.ts",
    "test": "deno test",
    "dev": "deno run --watch src/main.ts"
  }
}
```

**Features:**
- Task dependencies (run in parallel by default)
- Wildcard patterns (`deno task "build-*"`)
- Async commands with `&`

---

## Process Management

### Deno.Command (Built-in)
**Docs:** https://docs.deno.com/api/deno/~/Deno.Command

```typescript
const cmd = new Deno.Command("git", {
  args: ["status"],
  cwd: "/project",
  env: { GIT_AUTHOR_NAME: "Bot" },
  stdin: "piped",
  stdout: "piped",
  stderr: "piped",
});

// Option 1: Collect all output
const { code, stdout, stderr } = await cmd.output();

// Option 2: Spawn and interact
const process = cmd.spawn();
const writer = process.stdin.getWriter();
await writer.write(new TextEncoder().encode("input"));
await writer.close();
const status = await process.status;
```

**Key Points:**
- Use `"piped"` for stdin/stdout/stderr to capture
- Default inherits from parent process
- `process.kill(signal)` to terminate

**Use for:** SSH-15 (External command executor), SSH-31 (Process management)

### Limitations
- No native detached process support (setsid)
- Use `node:child_process` for Node.js compatibility if needed

---

## Logging

### LogTape (Recommended)
**GitHub:** https://github.com/dahlia/logtape

```typescript
import { configure, getLogger } from "jsr:@logtape/logtape";

await configure({
  sinks: { console: consoleSink() },
  loggers: [{ category: "safesh", level: "debug", sinks: ["console"] }],
});

const logger = getLogger("safesh");
logger.info("Starting SafeShell");
```

**Features:**
- Zero dependencies
- Structured logging
- Hierarchical categories
- Works in Deno, Node, Bun, browsers

### @std/log (Deprecated Soon)
**Note:** Deno team recommends OpenTelemetry instead

---

## Summary: Recommended Stack

| Component | Package | Notes |
|-----------|---------|-------|
| MCP Server | `npm:@modelcontextprotocol/sdk` | Official SDK |
| File System | `jsr:@std/fs` | walk, glob, copy, move |
| Paths | `jsr:@std/path` | Cross-platform |
| Streams | `jsr:@std/streams` | TransformStream utils |
| Async Utils | `jsr:@std/async` | pooledMap, debounce |
| CLI Args | `jsr:@std/cli` | Simple parseArgs, no bloat |
| Validation | `npm:zod` | Required by MCP SDK |
| Archives | `jsr:@std/tar` + `jsr:@deno-library/compress` | tar + zip |
| Colors | `jsr:@std/fmt/colors` | ANSI colors |
| Env Files | `jsr:@std/dotenv` | .env loading |
| Testing | `jsr:@std/testing` + `jsr:@std/assert` | Mocks, BDD |
| Logging | `jsr:@logtape/logtape` | Zero-dep, optional |
| Process | `Deno.Command` | Built-in |

---

## Installation Command

```bash
deno add \
  npm:@modelcontextprotocol/sdk \
  npm:zod \
  jsr:@std/fs \
  jsr:@std/path \
  jsr:@std/streams \
  jsr:@std/async \
  jsr:@std/cli \
  jsr:@std/fmt \
  jsr:@std/dotenv \
  jsr:@std/tar \
  jsr:@std/assert \
  jsr:@std/testing \
  jsr:@deno-library/compress
```

**Optional (only if needed):**
```bash
deno add jsr:@logtape/logtape  # Structured logging
deno add jsr:@cliffy/command   # Only if you want auto --help
```

---

## Sources

- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [Deno Standard Library on JSR](https://deno.com/blog/std-on-jsr)
- [JSR @std](https://jsr.io/@std)
- [@std/cli Documentation](https://jsr.io/@std/cli)
- [@std/fs Documentation](https://jsr.io/@std/fs)
- [@std/streams Documentation](https://jsr.io/@std/streams)
- [@std/async Documentation](https://jsr.io/@std/async)
- [Zod Documentation](https://zod.dev/)
- [Deno.Command API](https://docs.deno.com/api/deno/~/Deno.Command)
- [Cliffy Documentation](https://cliffy.io) (optional)
