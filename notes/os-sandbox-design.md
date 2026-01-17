# OS Sandbox Design: The Better Architecture

## TL;DR

**Current approach:** Rely on Deno's `--allow-run` (half-baked, doesn't work)

**Better approach:** Unsandboxed runner + OS sandbox per external command

## The Core Insight

### What Actually Matters for Security

```
Command Permission:    ❌ Theater (commands are just tools)
├─ rm -rf /           → Blocked by --allow-write, not --allow-run
├─ cat /etc/passwd    → Blocked by --allow-read
└─ Commands bounded by FS/network access anyway

File Permissions:      ✅ Critical (actual attack surface)
├─ Prevents reading sensitive files
├─ Prevents writing backdoors
└─ This is where real security happens

Network Permissions:   ✅ Critical (exfiltration vector)
└─ Prevents data theft
```

**Commands are just delivery mechanisms. The real security is controlling what they can touch.**

### The ONE Use Case That Matters

**Preventing accidental `rm -rf /` disasters.**

```bash
# The nightmare:
$ rm -rf /tmp/ test*
# Deleted: / tmp/ (everything)

# The horror stories every dev has
$ rm -rf ~
$ git clean -fdx /
$ docker system prune --all --volumes
```

This is 99.9% of actual accidents. And SafeShell solves it by:

1. ✅ Implementing `$.rm()` in TypeScript (subject to Deno `--allow-write`)
2. ✅ Blocking external `/bin/rm` (command validation)
3. ✅ Forcing use of the safe version

**Without this:** External `rm` bypasses Deno entirely and actually deletes files.
**With this:** Must use `$.rm()`, which Deno can restrict.

## Current Architecture (Flawed)

### What We Have Now

```
desh (Deno runtime with --allow-run)
  ├─ TypeScript builtins → Subject to Deno permissions ✅
  │    └─ $.rm(), $.cp(), $.mv()
  │
  └─ External commands → NOT restricted ❌
       ├─ git → Can access anything Deno allows
       ├─ npm → Can access anything Deno allows
       └─ docker → Can access anything Deno allows
```

### The Problem with Deno's `--allow-run`

```bash
# What Deno DOESN'T support:
--allow-run=/project/scripts  # ❌ Directories don't work
--allow-run=/project/*        # ❌ Wildcards not supported
--allow-run=script-*.sh       # ❌ Patterns not supported

# What you're forced to do:
--allow-run=/project/scripts/build.sh,/project/scripts/test.sh,...
# Must list EVERY script

# What everyone actually does:
--allow-run  # Unrestricted (defeats the purpose)
```

**Deno's `--allow-run` is half-baked and practically useless for real-world scenarios.**

### Deno vs Other Permissions

| Permission | Directories? | Wildcards? | Practical? |
|------------|-------------|------------|------------|
| `--allow-read` | ✅ Yes | ❌ No | ✅ Works great |
| `--allow-write` | ✅ Yes | ❌ No | ✅ Works great |
| `--allow-net` | ✅ Domains | ❌ No | ✅ Works great |
| `--allow-run` | ❌ **NO!** | ❌ No | ❌ Broken |

**Inconsistent design. Only `--allow-run` is broken.**

## The Better Architecture: OS Sandboxing

### The Correct Design

```
desh (UNSANDBOXED runner)
  ├─ TypeScript builtins → Deno permissions ✅
  │    └─ $.rm(), $.cp(), $.mv()
  │
  └─ External commands → OS sandbox PER COMMAND ✅
       ├─ git → sandbox: read=/project, write=/project/.git
       ├─ npm → sandbox: read=/project, write=/project/node_modules
       ├─ docker → sandbox: socket=/var/run/docker.sock
       └─ ./script.sh → sandbox: read=/project, write=/project/dist
```

**Key insight:** The runner is unsandboxed, so it has full power to apply different sandboxes to each spawned command.

### Why This Is Superior

#### vs. Claude Code's Approach

```
Claude Code (sandboxed):
  └─ Spawns: bash
       └─ Spawns: git      ← Inherits same sandbox
            └─ Spawns: ssh ← Inherits same sandbox

Problem:
  ❌ All subprocesses get same restrictions
  ❌ Can't differentiate git vs npm vs docker
  ❌ Too restrictive OR too permissive
```

```
SafeShell (unsandboxed runner):
  ├─ Spawns: git (custom sandbox for git)
  ├─ Spawns: npm (custom sandbox for npm)
  └─ Spawns: docker (custom sandbox for docker)

Benefits:
  ✅ Each command gets appropriate access
  ✅ git gets .git/, npm gets node_modules/
  ✅ Granular control per command
```

#### vs. Deno's --allow-run

```
Deno:
  ❌ Can't restrict per-invocation
  ❌ Either allow all or list every path
  ❌ No directory/wildcard support

OS sandbox:
  ✅ Custom policy per command
  ✅ Full directory/wildcard support
  ✅ Battle-tested (used by Docker, browsers, etc.)
```

## Implementation: OS Sandbox Primitives

### macOS: `sandbox-exec`

```bash
# Custom profile per command
sandbox-exec -p '(version 1)
  (allow file-read* (subpath "/project"))
  (allow file-write* (subpath "/project/.git"))
  (deny default)' \
  git commit -m "test"
```

**Pros:**
- Built into macOS
- Used by App Store apps
- Very mature

**Cons:**
- Complex profile language (Scheme-like)
- macOS only

### Linux: `bubblewrap`

```bash
# Namespace isolation
bwrap \
  --ro-bind /usr /usr \
  --ro-bind /project /project \
  --bind /project/node_modules /project/node_modules \
  --dev /dev \
  --proc /proc \
  npm install
```

**Pros:**
- Simple CLI interface
- Widely available
- Used by Flatpak

**Cons:**
- Linux only
- Requires bwrap installed

### Linux: `unshare` (built-in)

```bash
# Mount namespace isolation
unshare --mount --map-root-user \
  bash -c 'mount -o bind,ro /project /mnt && ./script.sh'
```

**Pros:**
- Built into Linux kernel
- No dependencies

**Cons:**
- Lower-level, more complex
- Requires root (or user namespaces)

### Linux: `firejail`

```bash
# High-level sandboxing
firejail \
  --private=/project \
  --whitelist=/project \
  --net=none \
  npm install
```

**Pros:**
- Very user-friendly
- Lots of built-in profiles

**Cons:**
- Requires firejail installed
- Can be heavy-handed

## Proposed SafeShell Architecture

### Config Format

```typescript
// .config/safesh/config.ts
export default {
  sandbox: {
    // Per-command sandbox policies
    git: {
      read: ["${CWD}"],
      write: ["${CWD}/.git"],
      network: false,
    },
    npm: {
      read: ["${CWD}", "/tmp"],
      write: ["${CWD}/node_modules", "/tmp"],
      network: ["registry.npmjs.org", "*.npmjs.com"],
    },
    docker: {
      read: ["${CWD}"],
      write: ["${CWD}"],
      socket: ["/var/run/docker.sock"],
      network: true,
    },
    // Project-local scripts
    "./scripts/*": {
      read: ["${CWD}"],
      write: ["${CWD}/dist", "/tmp"],
      network: false,
    },
    // Default for unknown commands
    default: {
      read: ["${CWD}"],
      write: ["/tmp"],
      network: false,
    }
  }
}
```

### Implementation

```typescript
// src/runtime/sandbox.ts

interface SandboxPolicy {
  read: string[];
  write: string[];
  network: boolean | string[];
  socket?: string[];
}

class OSSandbox {
  /**
   * Spawn command with OS-level sandbox
   */
  async spawn(
    command: string,
    args: string[],
    policy: SandboxPolicy,
  ): Promise<Deno.ChildProcess> {
    const platform = Deno.build.os;

    if (platform === "darwin") {
      return this.spawnMacOS(command, args, policy);
    } else if (platform === "linux") {
      return this.spawnLinux(command, args, policy);
    } else {
      // Fallback: no sandbox (Windows, etc.)
      return new Deno.Command(command, { args }).spawn();
    }
  }

  private spawnMacOS(
    command: string,
    args: string[],
    policy: SandboxPolicy,
  ): Deno.ChildProcess {
    // Generate sandbox profile
    const profile = this.generateMacOSProfile(policy);

    // Wrap in sandbox-exec
    return new Deno.Command("sandbox-exec", {
      args: ["-p", profile, command, ...args],
    }).spawn();
  }

  private spawnLinux(
    command: string,
    args: string[],
    policy: SandboxPolicy,
  ): Deno.ChildProcess {
    // Use bubblewrap if available
    if (this.hasBubblewrap()) {
      return this.spawnBubblewrap(command, args, policy);
    }

    // Fallback: unshare (built-in)
    return this.spawnUnshare(command, args, policy);
  }

  private generateMacOSProfile(policy: SandboxPolicy): string {
    return `
      (version 1)
      (deny default)
      ${policy.read.map(p => `(allow file-read* (subpath "${p}"))`).join("\n")}
      ${policy.write.map(p => `(allow file-write* (subpath "${p}"))`).join("\n")}
      ${policy.network ? "(allow network*)" : "(deny network*)"}
      ${policy.socket?.map(s => `(allow file-read* (literal "${s}"))`).join("\n") || ""}
    `;
  }
}
```

### Usage

```typescript
// User code (transpiled bash or TypeScript)
const [git] = await $.initCmds(["git"]);

// Under the hood:
// 1. initCmds() validates permission
// 2. Returns wrapper that spawns with OS sandbox
// 3. git runs with restricted access

await git("commit", "-m", "test");
// → Spawned as: sandbox-exec -p <profile> git commit -m test
// → Can only access /project/.git/
// → Cannot access /etc/, /usr/, etc.
```

## Migration Path

### Phase 1: Hybrid (Short-term)

Keep current Deno-based approach, add OS sandboxing as optional enhancement:

```typescript
export default {
  // Existing Deno permissions
  permissions: {
    read: ["${CWD}"],
    write: ["${CWD}"],
    run: ["git", "npm"],  // Still validate with initCmds
  },

  // NEW: OS sandbox policies (opt-in)
  sandbox: {
    enabled: true,  // Enable OS sandboxing
    git: { /* ... */ },
    npm: { /* ... */ },
  }
}
```

**Benefits:**
- Backward compatible
- Can be enabled gradually
- Falls back gracefully on unsupported platforms

### Phase 2: OS-first (Long-term)

Make OS sandboxing the primary mechanism:

```typescript
export default {
  sandbox: {
    // Per-command policies (primary)
    git: { read: ["${CWD}"], write: ["${CWD}/.git"] },
    npm: { read: ["${CWD}"], write: ["${CWD}/node_modules"] },

    // Fallback for unsupported platforms
    fallback: "deno",  // Use Deno permissions if OS sandbox unavailable
  }
}
```

**Benefits:**
- Proper per-command isolation
- Battle-tested OS primitives
- No reliance on Deno's broken `--allow-run`

## Why This Should Have Been The Design

### OS Sandboxing Is Mature

- **macOS sandbox:** Used by every App Store app since 2012
- **Linux namespaces:** Used by Docker, systemd, Flatpak since 2013
- **seccomp/seccomp-bpf:** Used by Chrome, Firefox, all modern browsers
- **Decades of hardening** against actual attacks

### Deno Permissions Are Half-Baked

- `--allow-run` doesn't support directories (inconsistent with other permissions)
- No wildcards or patterns (unlike every other sandbox)
- Permission query lies (returns "granted" but still denies)
- Forces `--allow-run` unrestricted (defeats the purpose)

### The Correct Architecture

```
Principle: Don't sandbox the runner, sandbox the clients

Wrong: Sandboxed runtime → Everything inherits same restrictions
Right: Unsandboxed runner → Apply custom sandbox per client
```

This is how every mature system works:
- **systemd:** Unsandboxed init, sandboxed services
- **Docker:** Unsandboxed daemon, sandboxed containers
- **Flatpak:** Unsandboxed runtime, sandboxed apps
- **Chrome:** Unsandboxed browser process, sandboxed renderers

## Lessons Learned

### What We Got Wrong

1. **Trusted Deno's marketing** - "Secure by default!" sounded great
2. **Didn't test `--allow-run` properly** - Assumed it worked like other permissions
3. **Invested in wrong abstraction** - Built around Deno permissions
4. **Ignored OS primitives** - Dismissed battle-tested solutions

### What We Should Have Done

1. **Test `--allow-run` first** - Would have found limitations immediately
2. **Use OS sandboxing from start** - Mature, proven, actually works
3. **Keep runner unsandboxed** - Maximum flexibility for spawning
4. **Custom policy per command** - git≠npm≠docker in access needs

### The Brutal Truth

**Node.js's "no security model" is more honest than Deno's "security theater".**

In production:
- Everyone uses `--allow-all` or `-A` anyway
- Real security comes from containers/VMs
- Runtime permissions are mostly marketing
- OS primitives do the heavy lifting

## Conclusion

SafeShell's current reliance on Deno's `--allow-run` is fundamentally flawed. The correct architecture is:

1. ✅ **Unsandboxed runner** (desh, bash-prehook) with full system access
2. ✅ **OS sandbox per command** with custom policies (git, npm, docker, etc.)
3. ✅ **TypeScript builtins** for dangerous operations ($.rm, $.cp, $.mv)
4. ✅ **Command validation** to prevent bypassing via external commands

This gives us:
- **Real security** via OS primitives (not Deno theater)
- **Granular control** per command (not one-size-fits-all)
- **Battle-tested** mechanisms (decades of hardening)
- **Honest architecture** (no pretending Deno can do what it can't)

**If we had known about Deno's half-baked `--allow-run`, we would have done this from day one.**
