# Session and Job Management Design

**Status**: Design Document (Revised)
**Author**: AI Assistant
**Date**: 2025-12-26

## Overview

Redesign session management to work like a shell environment with automatic job tracking. Every command execution creates a job that's tracked in the session history for posterity and debugging.

## Current State

**Problems:**
- `exec` and `bg` are separate tools (should be unified)
- Jobs tracked separately from sessions
- No command history in sessions
- Background jobs use different workflow than foreground

**Current Tools:**
- `exec` - Execute code synchronously
- `bg` - Execute in background
- `jobs` - List background jobs
- `jobOutput`, `kill`, `fg` - Manage background jobs
- `startSession`, `endSession`, `updateSession`, `listSessions` - Session management

## Proposed Design

### Mental Model

A session is like a shell environment where every command execution is automatically tracked as a job. This provides complete execution history for debugging and auditing.

### Data Structures

```typescript
interface Job {
  id: string;                // "job-{sessionId}-{seq}" (globally unique)
  code: string;              // Code that was executed
  pid: number;               // Process ID (always present for spawned processes)
  status: 'running' | 'completed' | 'failed';
  exitCode?: number;
  stdout: string;            // Capped at 1MB, truncated from start if exceeded
  stderr: string;            // Capped at 1MB, truncated from start if exceeded
  stdoutTruncated: boolean;  // True if stdout exceeded 1MB
  stderrTruncated: boolean;  // True if stderr exceeded 1MB
  startedAt: Date;
  completedAt?: Date;
  duration?: number;         // milliseconds
  background: boolean;       // Foreground or background execution
  process?: Deno.ChildProcess; // Internal: cleared after completion
}

interface Session {
  id: string;
  cwd: string;
  env: Record<string, string>;
  vars: Record<string, unknown>;
  createdAt: Date;
  lastActivityAt: Date;      // Updated on each exec

  // Job tracking
  jobs: Map<string, Job>;         // job-id -> Job (primary index)
  jobsByPid: Map<number, string>; // PID -> job-id (alternative lookup)
  jobSequence: number;            // Auto-increment counter
}
```

### Memory Limits

- **Per-session limit**: 50MB total (jobs + vars)
- **Per-job output limit**: 1MB each for stdout/stderr
- **Session count limit**: 10 active sessions (LRU eviction when exceeded)

When output exceeds 1MB:
1. Truncate from the start (keep most recent output)
2. Set `stdoutTruncated`/`stderrTruncated` flags
3. Log truncation event

### Tool Changes

#### 1. Unified `exec` Tool

Replace separate `exec` and `bg` with single tool:

```typescript
exec({
  sessionId: string,
  code: string,
  background?: boolean,  // NEW: false = sync, true = async
  timeout?: number,
  env?: Record<string, string>
})

// Sync execution (default)
→ Waits for completion
→ Returns: { stdout, stderr, code, success, jobId }
→ Job stored in session.jobs with status: 'completed'

// Async execution (background: true)
→ Returns immediately
→ Returns: { jobId, pid }
→ Job stored in session.jobs with status: 'running'
```

**External Commands:** Must be invoked through `cmd()` function in code:
```typescript
// Execute external command
exec({ code: "await cmd('ls', ['-la']).exec()", sessionId: "..." })

// Background external command
exec({
  code: "await cmd('npm', ['run', 'build']).exec()",
  sessionId: "...",
  background: true
})
```

#### 2. `listJobs` Tool

View jobs within a session:

```typescript
listJobs({
  sessionId: string,
  filter?: {
    status?: 'running' | 'completed' | 'failed',
    background?: boolean,
    limit?: number
  }
})

→ Returns array of jobs in execution order (newest first)
```

#### 3. Job Management Tools

```typescript
// Get job output (with optional offset for incremental reads)
getJobOutput({
  sessionId: string,
  jobId: string,
  since?: number  // byte offset
})
→ { stdout, stderr, offset, status, exitCode, truncated: { stdout, stderr } }

// Kill running job
killJob({
  sessionId: string,
  jobId: string,
  signal?: string  // default: SIGTERM
})

// Wait for background job to complete
waitJob({
  sessionId: string,
  jobId: string,
  timeout?: number  // optional timeout in ms
})
→ { stdout, stderr, code, success, duration }
```

#### 4. Remove Obsolete Tools

- ~~`bg`~~ → Use `exec` with `background: true`
- ~~`jobs`~~ → Use `listJobs`
- ~~`fg`~~ → Use `waitJob`
- ~~`jobOutput`~~ → Use `getJobOutput`
- ~~`kill`~~ → Use `killJob`

### Automatic Job Creation

Every `exec` call automatically:

1. Creates job record with ID: `job-${sessionId}-${session.jobSequence++}`
2. Records code, start time, status: 'running', background flag
3. Updates `lastActivityAt` on session
4. Executes code (sync or async)
5. For sync: updates job with result immediately
6. For async: job updated when process completes (via background collector)
7. Clears `job.process` handle after completion

### Command Tracking in Exec Code

Commands executed via streaming shell API (git, cmd, etc.) are also tracked when running in a session context:

```typescript
// In Command.exec()
if (globalThis.$session) {
  const job: Job = {
    id: `job-${$session.id}-${$session.jobSequence++}`,
    code: `${this.cmd} ${this.args.join(' ')}`,
    pid: 0,  // Set after spawn
    status: 'running',
    startedAt: new Date(),
    background: false,
    stdout: '',
    stderr: '',
    stdoutTruncated: false,
    stderrTruncated: false,
  };

  $session.jobs.set(job.id, job);

  try {
    const process = command.spawn();
    job.pid = process.pid;

    const result = await this.execSeparate();
    job.status = result.success ? 'completed' : 'failed';
    job.exitCode = result.code;
    job.stdout = truncateOutput(result.stdout, 1024 * 1024);
    job.stderr = truncateOutput(result.stderr, 1024 * 1024);
    job.stdoutTruncated = result.stdout.length > 1024 * 1024;
    job.stderrTruncated = result.stderr.length > 1024 * 1024;
    job.completedAt = new Date();
    job.duration = job.completedAt.getTime() - job.startedAt.getTime();
    return result;
  } catch (error) {
    job.status = 'failed';
    job.completedAt = new Date();
    throw error;
  }
}
```

### Session Lifecycle

**Creation:**
- Explicit: `startSession` creates managed session
- Implicit: `exec` without sessionId creates temporary session (not tracked)

**Tracking:**
- Only explicit sessions tracked in SessionManager
- Temporary sessions discarded after execution
- Jobs only accumulated in explicit sessions

**Cleanup:**
- Manual: `endSession` removes session and all its jobs
- Automatic LRU: When session count > 10, remove least recently active session
- Memory pressure: When session exceeds 50MB, trim oldest completed jobs

**Activity Tracking:**
- `lastActivityAt` updated on every `exec` call
- Used for LRU eviction decisions

### Background Job Completion

Background jobs have no callback mechanism (agents invoke jobs, no easy way to callback). Agents must poll for completion:

```typescript
// Recommended polling pattern
const { jobId } = await exec({ code: "...", background: true, sessionId });

// Poll for completion
let result;
while (true) {
  const output = await getJobOutput({ sessionId, jobId });
  if (output.status !== 'running') {
    result = output;
    break;
  }
  await sleep(1000);  // Poll every second
}
```

Alternative: Use `waitJob` which blocks until completion:
```typescript
const result = await waitJob({ sessionId, jobId, timeout: 60000 });
```

## Implementation Plan

### Phase 1: Core Infrastructure
1. Update Session type with new fields (lastActivityAt, memory tracking)
2. Update Job type (pid required, truncation flags, process cleanup)
3. Update SessionManager with LRU eviction and memory limits
4. Implement automatic job creation in executor

### Phase 2: Tool Updates
1. Add `background` parameter to `exec` tool
2. Rename/implement `listJobs` tool
3. Implement `getJobOutput`, `killJob`, `waitJob` tools
4. Remove obsolete tools (bg, jobs, fg, jobOutput, kill)

### Phase 3: Command Tracking
1. Make Command class session-aware via globalThis.$session
2. Auto-track commands in $session.jobs
3. Implement output truncation in Command class

### Phase 4: Documentation
1. Update tool descriptions
2. Add examples for new patterns
3. Document polling pattern for background jobs

## Implementation Notes

### Thread Safety

`jobSequence++` operations should be safe in Deno's single-threaded async model. However, ensure job creation is atomic:

```typescript
// Atomic job ID generation
const jobId = `job-${session.id}-${session.jobSequence}`;
session.jobSequence++;
```

### Process Handle Cleanup

Critical: Clear `job.process` after completion to allow GC:

```typescript
// In background collector
job.process!.status.then((status) => {
  job.status = status.code === 0 ? 'completed' : 'failed';
  job.exitCode = status.code;
  job.completedAt = new Date();
  job.process = undefined;  // Allow GC
});
```

### Memory Tracking

Approximate session memory usage:

```typescript
function estimateSessionMemory(session: Session): number {
  let size = 0;
  for (const job of session.jobs.values()) {
    size += job.stdout.length + job.stderr.length + job.code.length + 200; // overhead
  }
  size += JSON.stringify(session.vars).length;
  return size;
}
```

## Benefits

1. **Unified API** - One way to execute code (sync or async)
2. **Complete History** - All executions tracked for debugging/audit
3. **Shell-like** - Familiar mental model from bash/zsh
4. **Memory Safe** - Bounded output storage, LRU session eviction
5. **Efficient** - Map-based lookup for jobs by ID or PID

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Job ID format | `job-{sessionId}-{seq}` | Globally unique, human readable |
| PID field | Required | Every spawned process has a PID |
| Output limit | 1MB per stream | Balance between history and memory |
| Session limit | 10 sessions | Prevent unbounded growth |
| Session memory | 50MB max | Reasonable for job history |
| Cleanup strategy | LRU by lastActivityAt | Fair, predictable eviction |
| External commands | Via `cmd()` only | Consistent API, proper tracking |
| Background polling | Agent responsibility | No callback mechanism available |

## References

- Current Session type: `src/core/types.ts`
- Current SessionManager: `src/runtime/session.ts`
- Current MCP tools: `src/mcp/server.ts`
- Script management: `src/runtime/scripts.ts`
- Command class: `src/stdlib/command.ts`
