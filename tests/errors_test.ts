/**
 * Tests for core/errors.ts
 *
 * Validates AI-friendly error types and messages
 */

import { assertEquals, assertInstanceOf, assertStringIncludes } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import {
  SafeShellError,
  permissionDenied,
  commandNotWhitelisted,
  subcommandNotAllowed,
  flagNotAllowed,
  pathViolation,
  symlinkViolation,
  timeout,
  executionError,
  configError,
  importNotAllowed,
  type ErrorCode,
} from "../src/core/errors.ts";

describe("SafeShellError", () => {
  it("extends Error", () => {
    const err = new SafeShellError("EXECUTION_ERROR", "Test error");
    assertInstanceOf(err, Error);
    assertInstanceOf(err, SafeShellError);
  });

  it("has correct name", () => {
    const err = new SafeShellError("EXECUTION_ERROR", "Test error");
    assertEquals(err.name, "SafeShellError");
  });

  it("stores code, message, details, suggestion", () => {
    const err = new SafeShellError(
      "PATH_VIOLATION",
      "Path not allowed",
      { path: "/secret", allowed: ["/tmp"] },
      "Use an allowed path"
    );

    assertEquals(err.code, "PATH_VIOLATION");
    assertEquals(err.message, "Path not allowed");
    assertEquals(err.details?.path, "/secret");
    assertEquals(err.details?.allowed, ["/tmp"]);
    assertEquals(err.suggestion, "Use an allowed path");
  });

  describe("toJSON", () => {
    it("serializes to JSON-friendly object", () => {
      const err = new SafeShellError(
        "COMMAND_NOT_WHITELISTED",
        "rm not allowed",
        { command: "rm" },
        "Add to whitelist"
      );

      const json = err.toJSON();

      assertEquals(json.code, "COMMAND_NOT_WHITELISTED");
      assertEquals(json.message, "rm not allowed");
      assertEquals(json.details?.command, "rm");
      assertEquals(json.suggestion, "Add to whitelist");
    });

    it("handles undefined details and suggestion", () => {
      const err = new SafeShellError("TIMEOUT", "Timed out");
      const json = err.toJSON();

      assertEquals(json.code, "TIMEOUT");
      assertEquals(json.message, "Timed out");
      assertEquals(json.details, undefined);
      assertEquals(json.suggestion, undefined);
    });
  });
});

describe("Error Factory Functions", () => {
  describe("permissionDenied", () => {
    it("creates PERMISSION_DENIED error", () => {
      const err = permissionDenied("read", "/etc/passwd", ["/tmp", "/home"]);

      assertEquals(err.code, "PERMISSION_DENIED");
      assertStringIncludes(err.message, "Permission denied: read");
      assertStringIncludes(err.message, "/etc/passwd");
      assertEquals(err.details?.path, "/etc/passwd");
      assertEquals(err.details?.allowed, ["/tmp", "/home"]);
    });

    it("works without path", () => {
      const err = permissionDenied("net");

      assertEquals(err.code, "PERMISSION_DENIED");
      assertStringIncludes(err.message, "Permission denied: net");
    });

    it("provides helpful suggestion", () => {
      const err = permissionDenied("write", "/system");
      assertStringIncludes(err.suggestion!, "safesh.config.ts");
    });
  });

  describe("commandNotWhitelisted", () => {
    it("creates COMMAND_NOT_WHITELISTED error", () => {
      const err = commandNotWhitelisted("rm");

      assertEquals(err.code, "COMMAND_NOT_WHITELISTED");
      assertStringIncludes(err.message, "'rm'");
      assertStringIncludes(err.message, "not whitelisted");
      assertEquals(err.details?.command, "rm");
    });

    it("suggests alternatives", () => {
      const err = commandNotWhitelisted("curl");
      assertStringIncludes(err.suggestion!, "safesh.config.ts");
      assertStringIncludes(err.suggestion!, "exec()");
    });
  });

  describe("subcommandNotAllowed", () => {
    it("creates SUBCOMMAND_NOT_ALLOWED error", () => {
      const err = subcommandNotAllowed("docker", "run", ["ps", "logs", "build"]);

      assertEquals(err.code, "SUBCOMMAND_NOT_ALLOWED");
      assertStringIncludes(err.message, "'run'");
      assertStringIncludes(err.message, "'docker'");
      assertEquals(err.details?.command, "docker");
      assertEquals(err.details?.subcommand, "run");
      assertEquals(err.details?.allowed, ["ps", "logs", "build"]);
    });

    it("lists allowed subcommands in suggestion", () => {
      const err = subcommandNotAllowed("git", "push --force", ["add", "commit"]);
      assertStringIncludes(err.suggestion!, "add");
      assertStringIncludes(err.suggestion!, "commit");
    });
  });

  describe("flagNotAllowed", () => {
    it("creates FLAG_NOT_ALLOWED error", () => {
      const err = flagNotAllowed("git push", "--force", ["--force", "-f", "--hard"]);

      assertEquals(err.code, "FLAG_NOT_ALLOWED");
      assertStringIncludes(err.message, "'--force'");
      assertStringIncludes(err.message, "'git push'");
      assertEquals(err.details?.command, "git push");
      assertEquals(err.details?.flag, "--force");
      assertEquals(err.details?.denied, ["--force", "-f", "--hard"]);
    });

    it("suggests removal", () => {
      const err = flagNotAllowed("rm", "-rf", ["-rf", "--recursive"]);
      assertStringIncludes(err.suggestion!, "Remove the flag");
    });
  });

  describe("pathViolation", () => {
    it("creates PATH_VIOLATION error", () => {
      const err = pathViolation("/etc/passwd", ["/tmp", "/home"]);

      assertEquals(err.code, "PATH_VIOLATION");
      assertStringIncludes(err.message, "'/etc/passwd'");
      assertStringIncludes(err.message, "outside allowed directories");
      assertEquals(err.details?.path, "/etc/passwd");
      assertEquals(err.details?.allowed, ["/tmp", "/home"]);
    });

    it("includes resolved path when different", () => {
      const err = pathViolation("./link", ["/tmp"], "/actual/path");

      assertStringIncludes(err.message, "'./link'");
      assertStringIncludes(err.message, "'/actual/path'");
      assertEquals(err.details?.realPath, "/actual/path");
    });

    it("lists allowed directories in suggestion", () => {
      const err = pathViolation("/secret", ["/home/user", "/tmp"]);
      assertStringIncludes(err.suggestion!, "/home/user");
      assertStringIncludes(err.suggestion!, "/tmp");
    });
  });

  describe("symlinkViolation", () => {
    it("creates SYMLINK_VIOLATION error", () => {
      const err = symlinkViolation("/tmp/link", "/etc/shadow", ["/tmp"]);

      assertEquals(err.code, "SYMLINK_VIOLATION");
      assertStringIncludes(err.message, "Symlink");
      assertStringIncludes(err.message, "'/tmp/link'");
      assertStringIncludes(err.message, "'/etc/shadow'");
      assertEquals(err.details?.path, "/tmp/link");
      assertEquals(err.details?.realPath, "/etc/shadow");
    });

    it("explains symlink behavior", () => {
      const err = symlinkViolation("/link", "/target", ["/safe"]);
      assertStringIncludes(err.suggestion!, "Symlinks must resolve");
    });
  });

  describe("timeout", () => {
    it("creates TIMEOUT error", () => {
      const err = timeout(30000, "sleep 60");

      assertEquals(err.code, "TIMEOUT");
      assertStringIncludes(err.message, "30000ms");
      assertStringIncludes(err.message, "'sleep 60'");
      assertEquals(err.details?.command, "sleep 60");
    });

    it("works without command", () => {
      const err = timeout(5000);

      assertEquals(err.code, "TIMEOUT");
      assertStringIncludes(err.message, "5000ms");
    });

    it("suggests optimization", () => {
      const err = timeout(1000);
      assertStringIncludes(err.suggestion!, "timeout");
    });
  });

  describe("executionError", () => {
    it("creates EXECUTION_ERROR error", () => {
      const err = executionError("Syntax error at line 5", { path: "script.ts" });

      assertEquals(err.code, "EXECUTION_ERROR");
      assertStringIncludes(err.message, "Syntax error");
      assertEquals(err.details?.path, "script.ts");
    });

    it("works with just message", () => {
      const err = executionError("Unexpected token");
      assertEquals(err.code, "EXECUTION_ERROR");
    });
  });

  describe("configError", () => {
    it("creates CONFIG_ERROR error", () => {
      const err = configError("Invalid permission format");

      assertEquals(err.code, "CONFIG_ERROR");
      assertStringIncludes(err.message, "Invalid permission format");
      assertStringIncludes(err.suggestion!, "safesh.config.ts");
    });
  });

  describe("importNotAllowed", () => {
    it("creates IMPORT_NOT_ALLOWED error", () => {
      const err = importNotAllowed("npm:malicious-pkg", ["npm:*", "http:*"]);

      assertEquals(err.code, "IMPORT_NOT_ALLOWED");
      assertStringIncludes(err.message, "'npm:malicious-pkg'");
      assertEquals(err.details?.import, "npm:malicious-pkg");
      assertEquals(err.details?.denied, ["npm:*", "http:*"]);
    });

    it("suggests safe alternatives", () => {
      const err = importNotAllowed("http://evil.com/script.ts", ["http:*"]);
      assertStringIncludes(err.suggestion!, "jsr:@std/*");
    });
  });
});

describe("Error Types Coverage", () => {
  it("covers all error codes", () => {
    const allCodes: ErrorCode[] = [
      "PERMISSION_DENIED",
      "COMMAND_NOT_WHITELISTED",
      "SUBCOMMAND_NOT_ALLOWED",
      "FLAG_NOT_ALLOWED",
      "PATH_VIOLATION",
      "SYMLINK_VIOLATION",
      "TIMEOUT",
      "EXECUTION_ERROR",
      "CONFIG_ERROR",
      "IMPORT_NOT_ALLOWED",
    ];

    // Verify each code has a factory function
    const errors = [
      permissionDenied("test"),
      commandNotWhitelisted("cmd"),
      subcommandNotAllowed("cmd", "sub", []),
      flagNotAllowed("cmd", "-f", []),
      pathViolation("/path", []),
      symlinkViolation("/link", "/target", []),
      timeout(1000),
      executionError("msg"),
      configError("msg"),
      importNotAllowed("import", []),
    ];

    const foundCodes = errors.map((e) => e.code);
    assertEquals(foundCodes.sort(), allCodes.sort());
  });
});

describe("AI-Friendly Features", () => {
  it("all errors include actionable suggestions", () => {
    const errors = [
      permissionDenied("read", "/path", ["/tmp"]),
      commandNotWhitelisted("rm"),
      subcommandNotAllowed("docker", "run", ["ps"]),
      flagNotAllowed("git", "--force", ["--force"]),
      pathViolation("/secret", ["/home"]),
      symlinkViolation("/link", "/target", ["/safe"]),
      timeout(1000),
      configError("bad config"),
      importNotAllowed("npm:pkg", ["npm:*"]),
    ];

    for (const err of errors) {
      assertStringIncludes(
        err.suggestion ?? "",
        "",
        `Error ${err.code} should have a suggestion`
      );
      // Most suggestions should be non-empty
      if (err.code !== "EXECUTION_ERROR") {
        assertEquals(
          (err.suggestion?.length ?? 0) > 0,
          true,
          `${err.code} should have non-empty suggestion`
        );
      }
    }
  });

  it("details provide context for recovery", () => {
    const errWithPath = pathViolation("/forbidden", ["/allowed"]);
    assertEquals(errWithPath.details?.allowed?.length! > 0, true);

    const errWithCmd = commandNotWhitelisted("rm");
    assertEquals(errWithCmd.details?.command, "rm");

    const errWithFlag = flagNotAllowed("git", "--force", ["--force", "-f"]);
    assertEquals(errWithFlag.details?.denied?.includes("--force"), true);
  });
});
