# SafeShell Notes & Documentation

This directory contains design documents, implementation notes, and guides for SafeShell development.

## Quick Start for AI Agents

**Read these first:**
1. `TESTING.md` - How to run and write tests
2. `AGENT-INSTRUCTIONS.md` - Instructions for AI development
3. `DESIGN.md` - Overall architecture

## Documentation Index

### Core Documentation

| File | Description |
|------|-------------|
| `TESTING.md` | **Testing guide** - How to run tests, test organization, writing new tests |
| `DESIGN.md` | Overall SafeShell architecture and design |
| `STDLIB_DESIGN.md` | Standard library design (streams, commands, fs) |
| `STREAMING_SHELL_DESIGN.md` | Streaming shell implementation |
| `refactoring-summary.md` | DRY refactoring summary and core modules documentation |

### Implementation Guides

| File | Description |
|------|-------------|
| `bash-implementation-summary.md` | Bash transpiler implementation |
| `parser-migration-summary.md` | Parser migration notes |
| `SESSION_JOB_MANAGEMENT.md` | Session and job management |
| `MCP_SERVER_LIFECYCLE.md` | MCP server lifecycle |

### Feature Designs

| File | Description |
|------|-------------|
| `command-permission-design.md` | Command permission system |
| `SSH-119-workspace-config-design.md` | Workspace configuration |
| `XRUN_ARCHITECTURE_ANALYSIS.md` | xrun task runner analysis |

## Key Commands

```bash
# Run all tests
nvx deno test --allow-all

# Run core module tests (113 tests)
nvx deno test src/core/ --allow-all

# Run transpiler2 tests
nvx deno test src/bash/transpiler2/ --allow-all

# Run specific test
nvx deno test tests/state_test.ts --allow-all

# Check types
nvx deno check src/mod.ts
```

## Project Structure

```
safesh/
├── src/
│   ├── bash/           # Bash parser and transpiler
│   │   ├── parser.ts   # Bash parser
│   │   ├── ast.ts      # AST definitions
│   │   └── transpiler2/# Bash→TypeScript transpiler
│   ├── core/           # Core modules (DRY refactored)
│   │   ├── project-root.ts    # Project root discovery
│   │   ├── pending.ts         # Pending command/path management
│   │   ├── session.ts         # Session-based permissions
│   │   ├── error-handlers.ts  # Error detection & handling
│   │   └── *.test.ts          # 113 unit tests
│   ├── stdlib/         # Standard library
│   ├── runtime/        # Runtime execution
│   └── cli/            # CLI interface
├── hooks/              # bash-prehook.ts for Claude Code
├── tests/              # Test suites
└── notes/              # This directory
```

## Core Modules (DRY Refactoring)

SafeShell has 4 unified core modules that eliminate ~600 lines of duplication:

| Module | Purpose | Tests | Used By |
|--------|---------|-------|---------|
| `project-root.ts` | Find project root directory | 13 | bash-prehook, desh |
| `pending.ts` | Manage pending commands/paths | 23 | bash-prehook, desh |
| `session.ts` | Session-based permissions | 32 | bash-prehook, desh |
| `error-handlers.ts` | Error detection & handling | 45 | bash-prehook |

**Total:** 113 unit tests, all passing in ~237ms

**Key Benefits:**
- Single source of truth for shared logic
- Comprehensive test coverage prevents regressions
- Consistent behavior across all components
- Easy to maintain and extend

See `.temp/phase5-verification-report.md` for complete DRY refactoring details.

## Current Status

See the task manager for current issues:
```bash
# Using MCP tasks tool
{"cmd": "list", "type": "issue", "proj": "safesh", "filter": {"status": "open"}}
```

## Archive

Stale/outdated documents are moved to `notes/archive/`.
