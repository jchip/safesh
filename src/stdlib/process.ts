/**
 * Process management utilities
 *
 * Provides safe wrappers around Deno process management APIs with
 * sandbox checks and cross-platform support.
 *
 * @module
 */

/**
 * Options for spawning a process
 */
export interface SpawnOptions {
  /** Arguments to pass to the command */
  args?: string[];
  /** Working directory */
  cwd?: string;
  /** Environment variables (merged with current env by default) */
  env?: Record<string, string>;
  /** Clear environment (don't inherit from parent) */
  clearEnv?: boolean;
  /** Standard input mode */
  stdin?: "piped" | "inherit" | "null";
  /** Standard output mode */
  stdout?: "piped" | "inherit" | "null";
  /** Standard error mode */
  stderr?: "piped" | "inherit" | "null";
}

/**
 * Handle to a spawned process
 */
export interface ProcessHandle {
  /** Process ID */
  pid: number;
  /** Standard input (if piped) */
  stdin: WritableStream<Uint8Array> | null;
  /** Standard output (if piped) */
  stdout: ReadableStream<Uint8Array> | null;
  /** Standard error (if piped) */
  stderr: ReadableStream<Uint8Array> | null;
  /** Wait for process to complete */
  status(): Promise<ProcessStatus>;
  /** Kill the process with given signal */
  kill(signal?: Signal): void;
  /** Reference to underlying Deno.ChildProcess */
  ref(): void;
  /** Unreference the process */
  unref(): void;
}

/**
 * Process exit status
 */
export interface ProcessStatus {
  /** True if process exited successfully (code 0) */
  success: boolean;
  /** Exit code if exited normally */
  code?: number;
  /** Signal that terminated the process */
  signal?: Signal;
}

/**
 * Signals that can be sent to processes
 */
export type Signal =
  | "SIGABRT"
  | "SIGALRM"
  | "SIGBUS"
  | "SIGCHLD"
  | "SIGCONT"
  | "SIGEMT"
  | "SIGFPE"
  | "SIGHUP"
  | "SIGILL"
  | "SIGINFO"
  | "SIGINT"
  | "SIGIO"
  | "SIGKILL"
  | "SIGPIPE"
  | "SIGPROF"
  | "SIGPWR"
  | "SIGQUIT"
  | "SIGSEGV"
  | "SIGSTKFLT"
  | "SIGSTOP"
  | "SIGSYS"
  | "SIGTERM"
  | "SIGTRAP"
  | "SIGTSTP"
  | "SIGTTIN"
  | "SIGTTOU"
  | "SIGURG"
  | "SIGUSR1"
  | "SIGUSR2"
  | "SIGVTALRM"
  | "SIGWINCH"
  | "SIGXCPU"
  | "SIGXFSZ";

/**
 * Spawn a child process
 *
 * Wrapper around Deno.Command that provides a clean interface for
 * process management within SafeShell's sandbox.
 *
 * @param command - Command to execute
 * @param options - Spawn options
 * @returns Process handle
 *
 * @example
 * ```ts
 * // Spawn a process
 * const proc = await $.spawn('ls', { args: ['-la'] });
 * const status = await proc.status();
 * console.log(`Exit code: ${status.code}`);
 *
 * // Spawn with piped output
 * const proc = await $.spawn('echo', {
 *   args: ['hello'],
 *   stdout: 'piped'
 * });
 * const output = await new Response(proc.stdout).text();
 * ```
 */
export async function spawn(
  command: string,
  options: SpawnOptions = {},
): Promise<ProcessHandle> {
  const {
    args = [],
    cwd,
    env,
    clearEnv = false,
    stdin = "null",
    stdout = "inherit",
    stderr = "inherit",
  } = options;

  // Build environment
  const processEnv = clearEnv
    ? env ?? {}
    : { ...Deno.env.toObject(), ...env };

  // Create Deno.Command
  const denoCommand = new Deno.Command(command, {
    args,
    cwd,
    env: processEnv,
    stdin,
    stdout,
    stderr,
  });

  // Spawn the process
  const child = denoCommand.spawn();

  // Wrap in our ProcessHandle interface
  const handle: ProcessHandle = {
    pid: child.pid,
    stdin: stdin === "piped" ? child.stdin : null,
    stdout: stdout === "piped" ? child.stdout : null,
    stderr: stderr === "piped" ? child.stderr : null,

    async status(): Promise<ProcessStatus> {
      const status = await child.status;
      return {
        success: status.success,
        code: status.code,
        signal: status.signal as Signal | undefined,
      };
    },

    kill(signal: Signal = "SIGTERM"): void {
      child.kill(signal);
    },

    ref(): void {
      child.ref();
    },

    unref(): void {
      child.unref();
    },
  };

  return handle;
}

/**
 * Kill a process by PID
 *
 * Sends a signal to terminate a process. Defaults to SIGTERM for
 * graceful shutdown. Use SIGKILL for forceful termination.
 *
 * @param pid - Process ID to kill
 * @param signal - Signal to send (default: SIGTERM)
 *
 * @example
 * ```ts
 * // Graceful termination
 * $.kill(12345);
 *
 * // Force kill
 * $.kill(12345, 'SIGKILL');
 * ```
 */
export function kill(pid: number, signal: Signal = "SIGTERM"): void {
  Deno.kill(pid, signal);
}

/**
 * Information about a running process
 */
export interface ProcessInfo {
  /** Process ID */
  pid: number;
  /** Parent process ID */
  ppid?: number;
  /** Command name */
  command: string;
  /** Full command with arguments */
  commandLine?: string;
  /** CPU usage percentage */
  cpu?: number;
  /** Memory usage in KB */
  memory?: number;
  /** Process state (R=running, S=sleeping, Z=zombie, etc.) */
  state?: string;
  /** User running the process */
  user?: string;
}

/**
 * List running processes
 *
 * Returns a list of currently running processes. Implementation varies
 * by platform:
 * - Unix/Linux: uses `ps`
 * - macOS: uses `ps`
 * - Windows: uses `tasklist`
 *
 * @returns Array of process information
 *
 * @example
 * ```ts
 * const processes = await $.ps();
 * for (const proc of processes) {
 *   console.log(`${proc.pid}: ${proc.command}`);
 * }
 *
 * // Find processes by name
 * const nodeProcs = processes.filter(p => p.command.includes('node'));
 * ```
 */
export async function ps(): Promise<ProcessInfo[]> {
  const isWindows = Deno.build.os === "windows";

  if (isWindows) {
    return await psWindows();
  } else {
    return await psUnix();
  }
}

/**
 * Parse ps output on Unix/Linux/macOS
 */
async function psUnix(): Promise<ProcessInfo[]> {
  // Use ps with specific format for reliable parsing
  // Format: PID PPID USER %CPU %MEM STAT COMMAND
  const command = new Deno.Command("ps", {
    args: ["axo", "pid,ppid,user,%cpu,%mem,stat,command"],
    stdout: "piped",
    stderr: "piped",
  });

  const { code, stdout, stderr} = await command.output();

  if (code !== 0) {
    const stderrText = new TextDecoder().decode(stderr);
    throw new Error(`ps command failed: ${stderrText}`);
  }

  const result = {
    success: code === 0,
    stdout: new TextDecoder().decode(stdout),
    stderr: new TextDecoder().decode(stderr),
  };

  const lines = result.stdout.trim().split("\n");
  const processes: ProcessInfo[] = [];

  // Skip header line
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]?.trim();
    if (!line) continue;

    // Parse line (fields are space-separated, command may contain spaces)
    const match = line.match(
      /^(\d+)\s+(\d+)\s+(\S+)\s+([\d.]+)\s+([\d.]+)\s+(\S+)\s+(.+)$/,
    );
    if (!match) continue;

    const [, pid, ppid, user, cpu, mem, state, command] = match;
    if (!pid || !ppid || !cpu || !mem || !command) continue;

    processes.push({
      pid: parseInt(pid, 10),
      ppid: parseInt(ppid, 10),
      user: user || "unknown",
      cpu: parseFloat(cpu),
      memory: parseFloat(mem),
      state: state || "unknown",
      command: command.split(" ")[0] || "unknown",
      commandLine: command,
    });
  }

  return processes;
}

/**
 * Parse tasklist output on Windows
 */
async function psWindows(): Promise<ProcessInfo[]> {
  // Use tasklist with CSV format for reliable parsing
  const command = new Deno.Command("tasklist", {
    args: ["/FO", "CSV", "/NH"],
    stdout: "piped",
    stderr: "piped",
  });

  const { code, stdout, stderr } = await command.output();

  if (code !== 0) {
    const stderrText = new TextDecoder().decode(stderr);
    throw new Error(`tasklist command failed: ${stderrText}`);
  }

  const result = {
    success: code === 0,
    stdout: new TextDecoder().decode(stdout),
    stderr: new TextDecoder().decode(stderr),
  };

  const lines = result.stdout.trim().split("\n");
  const processes: ProcessInfo[] = [];

  for (const line of lines) {
    if (!line.trim()) continue;

    // Parse CSV line: "ImageName","PID","SessionName","Session#","MemUsage"
    const match = line.match(/"([^"]+)","(\d+)","[^"]*","[^"]*","([^"]+)"/);
    if (!match) continue;

    const [, command, pid, memUsage] = match;
    if (!command || !pid || !memUsage) continue;

    // Parse memory (e.g., "1,234 K" -> 1234)
    const memMatch = memUsage.match(/[\d,]+/);
    const memory = memMatch
      ? parseInt(memMatch[0].replace(/,/g, ""), 10)
      : undefined;

    processes.push({
      pid: parseInt(pid, 10),
      command,
      memory,
    });
  }

  return processes;
}

/**
 * Information about a process using a port
 */
export interface PortInfo {
  /** Port number */
  port: number;
  /** Protocol (tcp/udp) */
  protocol: string;
  /** Process ID */
  pid: number;
  /** Process name */
  process: string;
  /** Address bound to (e.g., "127.0.0.1", "*") */
  address?: string;
  /** Connection state (LISTEN, ESTABLISHED, etc.) */
  state?: string;
}

/**
 * Find processes listening on ports
 *
 * Returns information about processes that are listening on network ports.
 * Implementation varies by platform:
 * - Unix/Linux/macOS: uses `lsof -i`
 * - Windows: uses `netstat`
 *
 * @param port - Optional port number to filter by
 * @returns Array of port information
 *
 * @example
 * ```ts
 * // List all ports
 * const allPorts = await $.ports();
 *
 * // Find what's using port 8080
 * const port8080 = await $.ports(8080);
 * if (port8080.length > 0) {
 *   console.log(`Port 8080 is used by PID ${port8080[0].pid}`);
 * }
 * ```
 */
export async function ports(port?: number): Promise<PortInfo[]> {
  const isWindows = Deno.build.os === "windows";

  if (isWindows) {
    return await portsWindows(port);
  } else {
    return await portsUnix(port);
  }
}

/**
 * Parse lsof output on Unix/Linux/macOS
 */
async function portsUnix(port?: number): Promise<PortInfo[]> {
  // Use lsof to list internet connections
  const args = ["-i", "-P", "-n"];
  if (port !== undefined) {
    args.push(`-i:${port}`);
  }

  let result;
  try {
    const command = new Deno.Command("lsof", {
      args,
      stdout: "piped",
      stderr: "piped",
    });

    const { code, stdout, stderr } = await command.output();
    result = {
      success: code === 0,
      stdout: new TextDecoder().decode(stdout),
      stderr: new TextDecoder().decode(stderr),
    };
  } catch {
    // lsof might not be installed, try netstat as fallback
    return await portsNetstat(port);
  }

  if (!result.success) {
    // Try netstat as fallback
    return await portsNetstat(port);
  }

  const lines = result.stdout.trim().split("\n");
  const ports: PortInfo[] = [];

  // Skip header line
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]?.trim();
    if (!line) continue;

    // Parse lsof output
    // Format: COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME
    const parts = line.split(/\s+/);
    if (parts.length < 9) continue;

    const command = parts[0];
    const pidStr = parts[1];
    const name = parts[8]; // e.g., "*:8080 (LISTEN)" or "192.168.1.1:443->192.168.1.2:52341 (ESTABLISHED)"
    const protocolStr = parts[7];

    if (!command || !pidStr || !name || !protocolStr) continue;

    const pid = parseInt(pidStr, 10);

    // Parse NAME field
    const match = name.match(/([^:]+):(\d+)(?:\s+\((\w+)\))?/);
    if (!match) continue;

    const [, address, portNum, state] = match;
    if (!portNum) continue;

    const protocol = protocolStr.toLowerCase(); // tcp, udp, etc.

    ports.push({
      port: parseInt(portNum, 10),
      protocol,
      pid,
      process: command,
      address: address === "*" ? undefined : address,
      state: state || "UNKNOWN",
    });
  }

  return ports;
}

/**
 * Fallback: Parse netstat output on Unix/Linux/macOS
 */
async function portsNetstat(port?: number): Promise<PortInfo[]> {
  // Use netstat to list listening ports with PIDs
  const command = new Deno.Command("netstat", {
    args: ["-anp"],
    stdout: "piped",
    stderr: "piped",
  });

  const { code, stdout, stderr } = await command.output();

  if (code !== 0) {
    throw new Error("Failed to get port information (lsof and netstat unavailable)");
  }

  const result = {
    success: code === 0,
    stdout: new TextDecoder().decode(stdout),
    stderr: new TextDecoder().decode(stderr),
  };

  const lines = result.stdout.trim().split("\n");
  const ports: PortInfo[] = [];

  for (const line of lines) {
    if (!line.includes("LISTEN") && port !== undefined) continue;

    // Parse netstat output (varies by platform, this is a best-effort)
    // Example: tcp 0 0 0.0.0.0:8080 0.0.0.0:* LISTEN 12345/node
    const match = line.match(
      /(tcp|udp)\s+\d+\s+\d+\s+([^:]+):(\d+)\s+\S+\s+(\w+)(?:\s+(\d+)\/(\S+))?/,
    );
    if (!match) continue;

    const [, protocol, address, portNum, state, pid, processName] = match;
    if (!protocol || !portNum) continue;

    if (port !== undefined && parseInt(portNum, 10) !== port) continue;

    ports.push({
      port: parseInt(portNum, 10),
      protocol,
      pid: pid ? parseInt(pid, 10) : 0,
      process: processName || "unknown",
      address: address === "0.0.0.0" || address === "[::]" ? undefined : address,
      state: state || "UNKNOWN",
    });
  }

  return ports;
}

/**
 * Parse netstat output on Windows
 */
async function portsWindows(port?: number): Promise<PortInfo[]> {
  // Use netstat with -ano to get PIDs
  const command = new Deno.Command("netstat", {
    args: ["-ano"],
    stdout: "piped",
    stderr: "piped",
  });

  const { code, stdout, stderr } = await command.output();

  if (code !== 0) {
    const stderrText = new TextDecoder().decode(stderr);
    throw new Error(`netstat command failed: ${stderrText}`);
  }

  const result = {
    success: code === 0,
    stdout: new TextDecoder().decode(stdout),
    stderr: new TextDecoder().decode(stderr),
  };

  const lines = result.stdout.trim().split("\n");
  const ports: PortInfo[] = [];

  for (const line of lines) {
    if (!line.includes("LISTENING") && port !== undefined) continue;

    // Parse netstat output
    // Example: TCP 0.0.0.0:8080 0.0.0.0:0 LISTENING 12345
    const match = line.match(
      /^\s*(TCP|UDP)\s+([^:]+):(\d+)\s+\S+\s+(\w+)?\s+(\d+)/,
    );
    if (!match) continue;

    const [, protocol, address, portNum, state, pid] = match;
    if (!protocol || !portNum || !pid) continue;

    if (port !== undefined && parseInt(portNum, 10) !== port) continue;

    ports.push({
      port: parseInt(portNum, 10),
      protocol: protocol.toLowerCase(),
      pid: parseInt(pid, 10),
      process: "unknown", // Would need to query process name separately
      address: address === "0.0.0.0" || address === "[::]" ? undefined : address,
      state: state || "LISTENING",
    });
  }

  return ports;
}
