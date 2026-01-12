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
│   ├── stdlib/         # Standard library
│   ├── runtime/        # Runtime execution
│   └── cli/            # CLI interface
├── tests/              # Test suites
└── notes/              # This directory
```

## Current Status

See the task manager for current issues:
```bash
# Using MCP tasks tool
{"cmd": "list", "type": "issue", "proj": "safesh", "filter": {"status": "open"}}
```

## Archive

Stale/outdated documents are moved to `notes/archive/`.
