# Session and Job Management Design

**Status**: Design Document
**Author**: AI Assistant
**Date**: 2025-12-26

## Overview

Redesign session management to work like a shell prompt with automatic job tracking. Every command execution creates a job that's tracked in the session history.

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

### Mental Model: Session = Shell Prompt

A session is like a shell prompt where every command execution is automatically tracked as a job.

### Data Structures

```typescript
interface Job {
  id: string;              // "job-1", "job-2" (auto-increment)
  command: string;         // Code/command that was executed
  pid?: number;            // Process ID for external commands
  status: 'running' | 'completed' | 'failed';
  exitCode?: number;
  stdout: string;
  stderr: string;
  startedAt: Date;
  completedAt?: Date;
  duration?: number;       // milliseconds
  background: boolean;     // Foreground or background execution
}

interface Session {
  id: string;
  cwd: string;
  env: Record<string, string>;
  vars: Record<string, unknown>;

  // Job tracking
  jobs: Map<string, Job>;         // "job-1" -> Job (primary index)
  jobsByPid: Map<number, string>; // PID -> job-id (reverse lookup)
  jobSequence: number;             // Auto-increment counter
}
```

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

#### 2. New `sessionJobs` Tool

View and manage jobs within a session:

```typescript
sessionJobs({
  sessionId: string,
  filter?: {
    status?: 'running' | 'completed' | 'failed',
    background?: boolean,
    limit?: number
  }
})

→ Returns array of jobs in execution order
```

#### 3. Job Management Tools

Update existing tools to work with session context:

```typescript
// Get job output (buffered)
getJobOutput({
  sessionId: string,
  jobId: string,
  since?: number  // byte offset
})

// Kill running job
killJob({
  sessionId: string,
  jobId: string,
  signal?: string
})

// Wait for background job (like shell `fg`)
waitJob({
  sessionId: string,
  jobId: string,
  stream?: boolean  // Stream output while waiting
})
```

#### 4. Remove Obsolete Tools

- ~~`bg`~~ - Merged into `exec` with `background` parameter
- ~~`jobs`~~ - Replaced by `sessionJobs`
- ~~`fg`~~ - Replaced by `waitJob`

Keep but update:
- `jobOutput` → `getJobOutput` (add sessionId)
- `kill` → `killJob` (add sessionId)

### Automatic Job Creation

Every `exec` call automatically:

1. Creates job record: `job-${session.jobSequence++}`
2. Records command, start time, status: 'running'
3. Executes code (sync or async)
4. Updates job with result (exit code, stdout, stderr, completion time)
5. Stores in `session.jobs` Map

### Command Tracking in Exec Code

Commands executed via streaming shell API (git, cmd, etc.) also tracked:

```typescript
// In Command.exec()
if (globalThis.$session) {
  const job = {
    id: `job-${$session.jobSequence++}`,
    command: `${this.cmd} ${this.args.join(' ')}`,
    status: 'running',
    startedAt: new Date(),
    background: false,
    stdout: '',
    stderr: ''
  };

  $session.jobs.set(job.id, job);

  try {
    const result = await this.execSeparate();
    job.status = 'completed';
    job.exitCode = result.code;
    job.stdout = result.stdout;
    job.stderr = result.stderr;
    job.completedAt = new Date();
    return result;
  } catch (error) {
    job.status = 'failed';
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
- Manual: `endSession` removes session
- Automatic: Not implemented initially (future: timeout-based cleanup)

**History Limits:**
- Keep last N jobs per session (configurable, default 100)
- Truncate old jobs when limit exceeded

## Implementation Plan

### Phase 1: Core Infrastructure
1. Update Session type with job tracking
2. Update SessionManager to handle jobs
3. Implement automatic job creation in executor

### Phase 2: Tool Updates
1. Add `background` parameter to `exec` tool
2. Implement `sessionJobs` tool
3. Update `getJobOutput`, `killJob`, `waitJob` with sessionId

### Phase 3: Command Tracking
1. Make Command class session-aware
2. Auto-track commands in $session.jobs
3. Sync job state back to SessionManager

### Phase 4: Cleanup
1. Remove `bg`, `jobs`, `fg` tools
2. Update documentation
3. Update examples

## Migration Guide

**Before:**
```typescript
// Background execution
bg({ code: "await longTask()", sessionId: "sess-1" })
→ { jobId: "job-3" }

jobs({ sessionId: "sess-1" })
→ [{ id: "job-3", status: "running", ... }]

fg({ jobId: "job-3" })
→ streams output
```

**After:**
```typescript
// Background execution
exec({ code: "await longTask()", sessionId: "sess-1", background: true })
→ { jobId: "job-3", pid: 12345 }

sessionJobs({ sessionId: "sess-1" })
→ [{ id: "job-3", status: "running", ... }]

waitJob({ sessionId: "sess-1", jobId: "job-3", stream: true })
→ streams output
```

## Benefits

1. **Unified API** - One way to execute code (sync or async)
2. **Complete History** - All executions tracked automatically
3. **Shell-like** - Familiar mental model from bash/zsh
4. **Debuggable** - Full history of what happened in session
5. **Efficient** - Map-based lookup for jobs by ID or PID

## Open Questions

1. Should we limit job history size? (Propose: 100 jobs)
2. Should we implement automatic session cleanup? (Propose: Future enhancement)
3. Should temporary sessions have job tracking? (Propose: No - only explicit sessions)
4. Should we expose PID in job info? (Propose: Yes - useful for debugging)

## References

- Current Session type: `src/core/types.ts`
- Current SessionManager: `src/runtime/session.ts`
- Current MCP tools: `src/mcp/server.ts`
- Job management: `src/runtime/jobs.ts`
