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
| `refactoring-summary.md` | Bash parser/transpiler DRY refactoring |
| `phase4-dry-refactoring.md` | **Phase 4 utility consolidation** - io-utils, test-helpers, best practices |

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

## Utility Modules & DRY Refactoring

SafeShell has comprehensive utility modules from DRY refactoring efforts:

### Recent Refactorings (January 2026)

| Ticket | Module | Purpose | Status |
|--------|--------|---------|--------|
| SSH-421 | `core/path-utils.ts` | Consolidate path validation logic | ✅ Complete |
| SSH-420 | `commands/grep.ts` | Refactor Grep implementation | ✅ Complete |
| SSH-419 | `core/arg-parser.ts` | Centralize command argument parsing | ✅ Complete |
| SSH-418 | `runtime/subprocess-manager.ts` | Extract subprocess management | ✅ Complete |
| SSH-417 | `stdlib/shell.ts` | FluentShell extensibility | ✅ Complete |
| SSH-435 | `runtime/executor.ts` | Decompose executeCode() | ✅ Complete |
| SSH-436 | `transpiler2/handlers/commands.ts` | Decompose buildCommand() | ✅ Complete |
| SSH-439 | `transpiler2/handlers/commands.ts` | Refactor PipelineAssembler | ✅ Complete |
| SSH-448 | `tests/` | Migrate tests to test-helpers | ✅ Complete |

### Phase 4: Core Utilities (SSH-400)
**Status:** ✅ Complete (2026-01-27/28)

| Module | Purpose | Key Functions |
|--------|---------|---------------|
| `core/io-utils.ts` | JSON & directory operations | `readJsonFile`, `writeJsonFile`, `ensureDir` |
| `tests/helpers.ts` | Test utilities | `REAL_TMP`, `withTestDir`, `createTestDir` |
| `core/config.ts` | Config path helpers | `getGlobalConfigDir`, `getProjectConfigDir` |

**Impact:** ~200-250 lines eliminated, 35+ files migrated, 100% test coverage

### Core Permission Modules
**Status:** ✅ Complete

| Module | Purpose | Tests |
|--------|---------|-------|
| `project-root.ts` | Find project root directory | 13 |
| `pending.ts` | Manage pending commands/paths | 23 |
| `session.ts` | Session-based permissions | 32 |
| `error-handlers.ts` | Error detection & handling | 45 |

**Total:** 113 unit tests, all passing in ~237ms

**See:** `phase4-dry-refactoring.md` for complete documentation and best practices.

## Current Status

See the task manager for current issues:
```bash
# Using MCP tasks tool
{"cmd": "list", "type": "issue", "proj": "safesh", "filter": {"status": "open"}}
```

## Archive

Stale/outdated documents are moved to `notes/archive/`.
