/**
 * Conformance Tests for transpiler2
 *
 * These tests execute both the original bash script and the transpiled TypeScript,
 * comparing their outputs to ensure semantic equivalence.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { describe, it, beforeAll } from "@std/testing/bdd";
import { parse } from "../parser.ts";
import { transpile } from "./mod.ts";
import { echo, cd, pwd, pushd, popd, dirs, test as shellTest, which, chmod, ln, rm, cp, mv, mkdir, touch, ls } from "../../stdlib/shelljs/mod.ts";

// =============================================================================
// Test Execution Helpers
// =============================================================================

interface ExecutionResult {
  stdout: string;
  stderr: string;
  code: number;
}

/**
 * Execute a bash script and return the result
 */
async function executeBash(script: string): Promise<ExecutionResult> {
  const cmd = new Deno.Command("bash", {
    args: ["-c", script],
    stdout: "piped",
    stderr: "piped",
  });

  const { code, stdout, stderr } = await cmd.output();

  return {
    stdout: new TextDecoder().decode(stdout).trim(),
    stderr: new TextDecoder().decode(stderr).trim(),
    code,
  };
}

/**
 * Transpile a bash script and execute it as TypeScript
 */
async function executeTranspiled(bashScript: string): Promise<ExecutionResult> {
  // Parse and transpile
  const ast = parse(bashScript);
  let tsCode = transpile(ast, { imports: false, strict: false });

  // Convert the IIFE to an awaited call
  tsCode = tsCode.replace(/^\(async \(\)=> \{/, "await (async () => {");
  tsCode = tsCode.replace(/\}\)\(;$/, ")();");

  // Get the path to shelljs module
  const shelljsPath = new URL("../../stdlib/shelljs/mod.ts", import.meta.url).pathname;

  // Wrap in SafeShell mock runtime that captures and prints stdout
  const fullCode = `
// Import shelljs builtins
import { echo as __echo, cd as __cd, pwd as __pwd, pushd as __pushd, popd as __popd, dirs as __dirs, test as __testFn, which as __which, chmod as __chmod, ln as __ln, rm as __rm, cp as __cp, mv as __mv, mkdir as __mkdir, touch as __touch, ls as __ls } from "file://${shelljsPath}";

// Wrap test to return result object expected by transpiler
// Supports both file tests (-f, -d, etc.) and comparisons (-eq, -ne, =, !=, etc.)
async function __test(...args: string[]): Promise<{ code: number; stdout: string; stderr: string; success: boolean }> {
  let result = false;

  // Handle different test patterns
  if (args.length === 2) {
    // File test: test -f path
    result = await __testFn(args[0], args[1]);
  } else if (args.length === 3) {
    // Comparison: test val1 -eq val2 or test str1 = str2
    const [left, op, right] = args;
    switch (op) {
      case "-eq": result = parseInt(left) === parseInt(right); break;
      case "-ne": result = parseInt(left) !== parseInt(right); break;
      case "-lt": result = parseInt(left) < parseInt(right); break;
      case "-le": result = parseInt(left) <= parseInt(right); break;
      case "-gt": result = parseInt(left) > parseInt(right); break;
      case "-ge": result = parseInt(left) >= parseInt(right); break;
      case "=":
      case "==": result = left === right; break;
      case "!=": result = left !== right; break;
      default: result = false;
    }
  } else if (args.length === 1) {
    // String test: test -n str or test -z str
    const arg = args[0];
    if (arg.startsWith("-n ")) {
      result = arg.slice(3).length > 0;
    } else if (arg.startsWith("-z ")) {
      result = arg.slice(3).length === 0;
    } else {
      // Non-empty string test
      result = arg.length > 0;
    }
  }

  return { code: result ? 0 : 1, stdout: "", stderr: "", success: result };
}

// Helper function to execute commands and print their output (matches preamble)
async function __printCmd(cmd: any): Promise<number> {
  const result = await cmd;
  if (typeof result === 'boolean') return result ? 0 : 1;
  if (!result) return 1;
  if (result.stdout) {
    await Deno.stdout.write(new TextEncoder().encode(result.stdout));
  }
  if (result.stderr) {
    await Deno.stderr.write(new TextEncoder().encode(result.stderr));
  }
  return result.code;
}

// Helper for command substitution text extraction
async function __cmdSubText(cmd: any): Promise<string> {
  const result = await cmd;
  // Strip trailing newlines like bash does for command substitution
  return (result.stdout || '').replace(/\\n+$/, '');
}

// Mock SafeShell runtime for conformance testing
const $ = {
  // Builtins mapped to imported functions
  echo: __echo,
  cd: __cd,
  pwd: __pwd,
  pushd: __pushd,
  popd: __popd,
  dirs: __dirs,
  test: __test,
  which: __which,
  chmod: __chmod,
  ln: __ln,
  rm: __rm,
  cp: __cp,
  mv: __mv,
  mkdir: __mkdir,
  touch: __touch,
  ls: __ls,

  cmd: (command: string, ...args: string[]) => {
    // Build command string from function call args
    const cmdStr = args.length > 0 ? command + ' ' + args.join(' ') : command;
    const cmdObj = {
      _cmd: cmdStr,
      _stdout: '' as string,
      _stderr: '' as string,
      code: 0,
      async exec() {
        const proc = new Deno.Command("bash", {
          args: ["-c", this._cmd],
          stdout: "piped",
          stderr: "piped",
        });
        const result = await proc.output();
        this.code = result.code;
        this._stdout = new TextDecoder().decode(result.stdout);
        this._stderr = new TextDecoder().decode(result.stderr);
        return {
          code: result.code,
          stdout: this._stdout,
          stderr: this._stderr,
          success: result.code === 0,
        };
      },
      async then(onFulfill: (v: unknown) => unknown, onReject?: (e: unknown) => unknown) {
        try {
          const result = await this.exec();
          return onFulfill ? onFulfill(result) : result;
        } catch (e) {
          if (onReject) return onReject(e);
          throw e;
        }
      },
      async catch(onReject: (e: unknown) => unknown) {
        try {
          return await this.exec();
        } catch (e) {
          return onReject(e);
        }
      },
      pipe(next: unknown) { return this; },
      stdout(file: string, opts?: { append?: boolean }) { return this; },
      stderr(file: string, opts?: { append?: boolean }) { return this; },
      stdin(file: string) { return this; },
    };
    return cmdObj;
  },
  cat: (...files: string[]) => $.cmd("cat", ...files),
  grep: (pattern: RegExp) => ({ pipe: () => ({ run: async () => ({ code: 0, stdout: '', stderr: '' }) }) }),
  head: (n: number) => ({ pipe: () => ({ run: async () => ({ code: 0, stdout: '', stderr: '' }) }) }),
  tail: (n: number) => ({ pipe: () => ({ run: async () => ({ code: 0, stdout: '', stderr: '' }) }) }),
  sort: (opts?: object) => ({ pipe: () => ({ run: async () => ({ code: 0, stdout: '', stderr: '' }) }) }),
  uniq: (opts?: object) => ({ pipe: () => ({ run: async () => ({ code: 0, stdout: '', stderr: '' }) }) }),
  wc: (opts?: object) => ({ pipe: () => ({ run: async () => ({ code: 0, stdout: '', stderr: '' }) }) }),
  tee: (file: string) => ({ pipe: () => ({ run: async () => ({ code: 0, stdout: '', stderr: '' }) }) }),
  tr: (from: string, to: string) => ({ pipe: () => ({ run: async () => ({ code: 0, stdout: '', stderr: '' }) }) }),
  cut: (opts?: object) => ({ pipe: () => ({ run: async () => ({ code: 0, stdout: '', stderr: '' }) }) }),
  fs: {
    exists: async (path: string) => {
      try { await Deno.stat(path); return true; } catch { return false; }
    },
    stat: async (path: string) => {
      try {
        const info = await Deno.stat(path);
        return {
          isFile: info.isFile,
          isDirectory: info.isDirectory,
          isSymlink: info.isSymlink,
          size: info.size,
          mtime: info.mtime,
          atime: info.atime,
          mode: info.mode,
          uid: info.uid,
          gid: info.gid,
          ino: info.ino,
        };
      } catch { return null; }
    },
    readable: async (path: string) => {
      try { await Deno.open(path, { read: true }); return true; } catch { return false; }
    },
    writable: async (path: string) => {
      try { await Deno.open(path, { write: true }); return true; } catch { return false; }
    },
    executable: async (path: string) => {
      try {
        const info = await Deno.stat(path);
        return ((info.mode ?? 0) & 0o111) !== 0;
      } catch { return false; }
    },
  },
};

// Execute transpiled code
${tsCode}
`;

  // Write to temp file and execute
  const tempFile = await Deno.makeTempFile({ suffix: ".ts" });
  try {
    await Deno.writeTextFile(tempFile, fullCode);

    // Get the project's deno.json config path (test is in src/bash/transpiler2/)
    const configPath = new URL("../../../deno.json", import.meta.url).pathname;

    const cmd = new Deno.Command("deno", {
      args: ["run", "--allow-all", "--config", configPath, tempFile],
      stdout: "piped",
      stderr: "piped",
    });

    const { code, stdout, stderr } = await cmd.output();

    return {
      stdout: new TextDecoder().decode(stdout).trim(),
      stderr: new TextDecoder().decode(stderr).trim(),
      code,
    };
  } finally {
    await Deno.remove(tempFile);
  }
}

/**
 * Compare bash and transpiled execution, checking if outputs match
 */
async function compareExecution(
  bashScript: string,
  options?: {
    compareStdout?: boolean;
    compareExitCode?: boolean;
    outputContains?: string[];
  }
): Promise<{
  bashResult: ExecutionResult;
  tsResult: ExecutionResult;
  match: boolean;
}> {
  const opts = {
    compareStdout: true,
    compareExitCode: false,
    outputContains: [],
    ...options,
  };

  const [bashResult, tsResult] = await Promise.all([
    executeBash(bashScript),
    executeTranspiled(bashScript),
  ]);

  let match = true;

  if (opts.compareStdout) {
    match = match && bashResult.stdout === tsResult.stdout;
  }

  if (opts.compareExitCode) {
    match = match && bashResult.code === tsResult.code;
  }

  for (const str of opts.outputContains ?? []) {
    match = match && tsResult.stdout.includes(str);
  }

  return { bashResult, tsResult, match };
}

// =============================================================================
// Simple Command Conformance Tests
// =============================================================================

describe("Conformance - Simple Commands", () => {
  it("should execute echo command correctly", async () => {
    const script = 'echo "hello world"';
    const { bashResult, tsResult } = await compareExecution(script);
    assertEquals(tsResult.stdout, bashResult.stdout);
  });

  it("should execute echo with variable", async () => {
    const script = `
      NAME="World"
      echo "Hello, $NAME"
    `;
    const { bashResult, tsResult } = await compareExecution(script);
    assertEquals(tsResult.stdout, bashResult.stdout);
  });

  it("should execute multiple echo commands", async () => {
    const script = `
      echo "line 1"
      echo "line 2"
      echo "line 3"
    `;
    const { bashResult, tsResult } = await compareExecution(script);
    assertEquals(tsResult.stdout, bashResult.stdout);
  });
});

// =============================================================================
// Variable Expansion Conformance Tests
// =============================================================================

describe("Conformance - Variable Expansion", () => {
  it("should handle simple variable expansion", async () => {
    const script = `
      VAR="test value"
      echo "$VAR"
    `;
    const { bashResult, tsResult } = await compareExecution(script);
    assertEquals(tsResult.stdout, bashResult.stdout);
  });

  it("should handle variable with braces", async () => {
    const script = `
      PREFIX="hello"
      echo "\${PREFIX}_suffix"
    `;
    const { bashResult, tsResult } = await compareExecution(script);
    assertEquals(tsResult.stdout, bashResult.stdout);
  });
});

// =============================================================================
// Arithmetic Conformance Tests
// =============================================================================

describe("Conformance - Arithmetic", () => {
  it("should handle arithmetic expansion", async () => {
    const script = 'echo $((2 + 3))';
    const { bashResult, tsResult } = await compareExecution(script);
    assertEquals(tsResult.stdout, bashResult.stdout);
  });

  it("should handle complex arithmetic", async () => {
    const script = 'echo $((10 * 5 - 20 / 4))';
    const { bashResult, tsResult } = await compareExecution(script);
    assertEquals(tsResult.stdout, bashResult.stdout);
  });
});

// =============================================================================
// Control Flow Conformance Tests
// =============================================================================

describe("Conformance - Control Flow", () => {
  it("should handle if-then with true condition", async () => {
    const script = `
      if test 1 -eq 1
      then
        echo "equal"
      fi
    `;
    const { bashResult, tsResult } = await compareExecution(script);
    assertEquals(tsResult.stdout, bashResult.stdout);
  });

  it("should handle if-else with false condition", async () => {
    const script = `
      if test 1 -eq 2
      then
        echo "equal"
      else
        echo "not equal"
      fi
    `;
    const { bashResult, tsResult } = await compareExecution(script);
    assertEquals(tsResult.stdout, bashResult.stdout);
  });

  it("should handle elif chain with multiple conditions", async () => {
    const script = `
      x="b"
      if test "$x" = "a"
      then
        echo a
      elif test "$x" = "b"
      then
        echo b
      fi
    `;
    const { bashResult, tsResult } = await compareExecution(script);
    assertEquals(tsResult.stdout, bashResult.stdout);
  });

  it("should handle elif chain with else fallback", async () => {
    const script = `
      x="c"
      if test "$x" = "a"
      then
        echo a
      elif test "$x" = "b"
      then
        echo b
      else
        echo other
      fi
    `;
    const { bashResult, tsResult } = await compareExecution(script);
    assertEquals(tsResult.stdout, bashResult.stdout);
  });

  it("should handle for loop", async () => {
    const script = `
      for i in a b c
      do
        echo "item: $i"
      done
    `;
    const { bashResult, tsResult } = await compareExecution(script);
    assertEquals(tsResult.stdout, bashResult.stdout);
  });

  it("should handle case statement with string literal", async () => {
    // Note: case with variable requires proper string comparison
    // which works differently in the transpiled output
    const script = `
      case "b" in
        a)
          echo "A"
          ;; 
        b)
          echo "B"
          ;; 
      esac
    `;
    const { bashResult, tsResult } = await compareExecution(script);
    assertEquals(tsResult.stdout, bashResult.stdout);
  });

  it("should handle case statement with glob patterns (*.txt)", async () => {
    const script = `
      case "file.txt" in
        *.txt)
          echo "text file"
          ;; 
        *.sh)
          echo "shell script"
          ;; 
        *)
          echo "other"
          ;; 
      esac
    `;
    const { bashResult, tsResult } = await compareExecution(script);
    assertEquals(tsResult.stdout, bashResult.stdout);
    assertEquals(tsResult.stdout, "text file");
  });

  it("should handle case statement with *.tar.gz pattern", async () => {
    const script = `
      case "archive.tar.gz" in
        *.tar.gz)
          echo "tarball"
          ;; 
        *)
          echo "not a tarball"
          ;; 
      esac
    `;
    const { bashResult, tsResult } = await compareExecution(script);
    assertEquals(tsResult.stdout, bashResult.stdout);
    assertEquals(tsResult.stdout, "tarball");
  });

  it("should handle case statement with question mark pattern", async () => {
    const script = `
      case "a" in
        ?)
          echo "single character"
          ;; 
        *)
          echo "multiple characters"
          ;; 
      esac
    `;
    const { bashResult, tsResult } = await compareExecution(script);
    assertEquals(tsResult.stdout, bashResult.stdout);
    assertEquals(tsResult.stdout, "single character");
  });

  it("should handle case statement with character class pattern", async () => {
    const script = `
      case "abc.txt" in
        [abc]*.txt)
          echo "starts with a, b, or c"
          ;; 
        *)
          echo "other"
          ;; 
      esac
    `;
    const { bashResult, tsResult } = await compareExecution(script);
    assertEquals(tsResult.stdout, bashResult.stdout);
    assertEquals(tsResult.stdout, "starts with a, b, or c");
  });

  it("should handle case statement with wildcard pattern (*)", async () => {
    const script = `
      case "anything" in
        *)
          echo "matches everything"
          ;; 
      esac
    `;
    const { bashResult, tsResult } = await compareExecution(script);
    assertEquals(tsResult.stdout, bashResult.stdout);
    assertEquals(tsResult.stdout, "matches everything");
  });
});

// =============================================================================
// Command Substitution Conformance Tests
// =============================================================================
// Note: Command substitution requires the full SafeShell runtime to work properly.
// These tests are skipped in basic conformance testing but can be enabled
// when the full runtime is available.

describe("Conformance - Command Substitution", () => {
  it("should parse command substitution syntax", async () => {
    // Just verify parsing works - execution requires full runtime
    const script = 'VAR=$(echo test)';
    const ast = parse(script);
    const output = transpile(ast, { imports: false });
    assertStringIncludes(output, "VAR");
  });
});

// =============================================================================
// Function Conformance Tests
// =============================================================================
// Note: Function execution in transpiled code requires async handling.
// The function calls work but the execution order may differ slightly.

describe("Conformance - Functions", () => {
  it("should generate proper function declaration", async () => {
    const script = `
      function greet {
        echo "Hello"
      }
    `;
    const ast = parse(script);
    const output = transpile(ast, { imports: false });
    assertStringIncludes(output, "async function greet()")
  });

  it("should transpile function with simple echo", async () => {
    // Note: Function calls in transpiled code require proper async handling
    // which the mock runtime doesn't fully support. We verify the structure.
    const script = `
      function say_hello {
        echo "Hello"
      }
    `;
    const ast = parse(script);
    const output = transpile(ast, { imports: false });
    assertStringIncludes(output, "async function say_hello()")
    // SSH-372: Transpiler now outputs $.echo("Hello") using preamble builtins
    assertStringIncludes(output, '$.echo(');
    assertStringIncludes(output, '"Hello"');
  });
});

// =============================================================================
// Complex Script Conformance Tests
// =============================================================================

describe("Conformance - Complex Scripts", () => {
  it("should handle for loop with conditional", async () => {
    const script = `
      for i in a b c
      do
        if test "$i" = "b"
        then
          echo "Found b"
        fi
      done
    `;
    const { bashResult, tsResult } = await compareExecution(script);
    assertEquals(tsResult.stdout, bashResult.stdout);
  });

  it("should handle simple variable assignment and echo", async () => {
    const script = `
      MSG="test message"
      echo "$MSG"
    `;
    const { bashResult, tsResult } = await compareExecution(script);
    assertEquals(tsResult.stdout, bashResult.stdout);
  });

  it("should handle database backup script pattern", async () => {
    const script = `
      DB_NAME="mydb"
      BACKUP_PATH="/tmp/mydb.bak"

      echo "Backing up database: $DB_NAME"
      echo "Would backup to: $BACKUP_PATH"
      echo "Backup complete"
    `;
    const { bashResult, tsResult } = await compareExecution(script);
    assertEquals(tsResult.stdout, bashResult.stdout);
  });

  it("should handle health check script with for loop and conditionals", async () => {
    const script = `
      FAILED=""
      response="500"

      for service in api worker
      do
        echo "Checking $service"
        if test "$response" != "200"
        then
          FAILED="$FAILED $service"
          echo "FAIL: $service"
        else
          echo "OK: $service"
        fi
      done
      echo "Check complete"
    `;
    const { bashResult, tsResult } = await compareExecution(script);
    assertEquals(tsResult.stdout, bashResult.stdout);
  });

  it("should handle branch check conditional - feature branch", async () => {
    const script = `
      BRANCH="feature"

      if test "$BRANCH" = "main"
      then
        echo "Cannot run on main branch"
      else
        echo "On branch: $BRANCH"
        echo "Safe to proceed"
      fi

      echo "Check complete"
    `;
    const { bashResult, tsResult } = await compareExecution(script);
    assertEquals(tsResult.stdout, bashResult.stdout);
  });

  it("should handle branch check conditional - main branch", async () => {
    const script = `
      BRANCH="main"

      if test "$BRANCH" = "main"
      then
        echo "Cannot run on main branch"
      else
        echo "On branch: $BRANCH"
        echo "Safe to proceed"
      fi

      echo "Check complete"
    `;
    const { bashResult, tsResult } = await compareExecution(script);
    assertEquals(tsResult.stdout, bashResult.stdout);
  });
});

describe("Conformance - Indirect Variable Reference (SSH-330)", () => {
  it("should handle simple indirect reference ${!ref}", async () => {
    const script = `
      ref="name"
      name="John"
      echo "\${!ref}"
    `;
    const { bashResult, tsResult } = await compareExecution(script);
    assertEquals(tsResult.stdout, bashResult.stdout);
    assertEquals(tsResult.stdout, "John");
  });

  it("should handle indirect reference with assignment", async () => {
    const script = `
      var1="greeting"
      greeting="Hello World"
      result="\${!var1}"
      echo "$result"
    `;
    const { bashResult, tsResult } = await compareExecution(script);
    assertEquals(tsResult.stdout, bashResult.stdout);
    assertEquals(tsResult.stdout, "Hello World");
  });

  it("should handle multiple indirect references", async () => {
    const script = `
      first="one"
      second="two"
      one="First Value"
      two="Second Value"
      echo "\${!first} - \${!second}"
    `;
    const { bashResult, tsResult } = await compareExecution(script);
    assertEquals(tsResult.stdout, bashResult.stdout);
    assertEquals(tsResult.stdout, "First Value - Second Value");
  });
});

// =============================================================================
// Test Runner Utility
// =============================================================================

/**
 * Run a conformance test and return detailed results
 */
export async function runConformanceTest(
  name: string,
  bashScript: string
): Promise<{
  name: string;
  bashOutput: string;
  tsOutput: string;
  match: boolean;
  transpiled: string;
}> {
  const ast = parse(bashScript);
  const transpiled = transpile(ast);

  const { bashResult, tsResult, match } = await compareExecution(bashScript);

  return {
    name,
    bashOutput: bashResult.stdout,
    tsOutput: tsResult.stdout,
    match,
    transpiled,
  };
}

/**
 * Run multiple conformance tests and return a report
 */
export async function runConformanceSuite(
  tests: Array<{ name: string; script: string }>
): Promise<{
  passed: number;
  failed: number;
  results: Array<{
    name: string;
    match: boolean;
    bashOutput: string;
    tsOutput: string;
  }>;
}> {
  const results = [];
  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    try {
      const result = await runConformanceTest(test.name, test.script);
      results.push({
        name: result.name,
        match: result.match,
        bashOutput: result.bashOutput,
        tsOutput: result.tsOutput,
      });
      if (result.match) {
        passed++;
      } else {
        failed++;
      }
    } catch (e) {
      results.push({
        name: test.name,
        match: false,
        bashOutput: "ERROR",
        tsOutput: e instanceof Error ? e.message : String(e),
      });
      failed++;
    }
  }

  return { passed, failed, results };
}