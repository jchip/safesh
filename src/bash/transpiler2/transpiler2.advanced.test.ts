/**
 * Advanced tests for transpiler2
 *
 * This test suite covers edge cases, complex scenarios, and real-world patterns
 * that extend beyond the basic and comprehensive test suites.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { parse } from "../parser.ts";
import { transpile } from "./mod.ts";

// Helper function
function transpileBash(bash: string): string {
  const ast = parse(bash);
  return transpile(ast);
}

// =============================================================================
// Background Jobs and Job Control
// =============================================================================

describe("Background Jobs", () => {
  it("should handle simple background job with &", () => {
    const code = transpileBash("sleep 10 &");
    assertStringIncludes(code, '"sleep", "10"');
    // Background job handling may vary based on implementation
  });

  it("should handle multiple background jobs", () => {
    const code = transpileBash(`
      command1 &
      command2 &
      command3 &
    `);
    assertStringIncludes(code, "command1");
    assertStringIncludes(code, "command2");
    assertStringIncludes(code, "command3");
  });

  it("should handle background job with pipeline", () => {
    const code = transpileBash("cat file | grep pattern | sort &");
    assertStringIncludes(code, ".pipe(");
  });

  it("should handle foreground and background jobs mixed", () => {
    const code = transpileBash(`
      echo "Starting"
      long_task &
      echo "Job started"
      wait
    `);
    assertStringIncludes(code, "long_task");
    assertStringIncludes(code, "wait");
  });
});

// =============================================================================
// Complex Quoting and Escaping
// =============================================================================

describe("Complex Quoting Scenarios", () => {
  it("should handle mixed single and double quotes", () => {
    const code = transpileBash(`echo 'single' "double" 'more'`);
    assertStringIncludes(code, "__echo(");
  });

  it("should handle escaped quotes inside double quotes", () => {
    const code = transpileBash(`echo "say \\"hello\\"`);
    assertStringIncludes(code, "__echo(");
  });

  it("should handle escaped single quotes", () => {
    const code = transpileBash(`echo 'it\\'s working'`);
    assertStringIncludes(code, "__echo(");
  });

  it("should handle backslash escaping", () => {
    const code = transpileBash(`echo "path\\to\\file"`);
    assertStringIncludes(code, "__echo(");
  });

  it("should handle newline escaping", () => {
    const code = transpileBash(`echo "line1\\nline2"`);
    assertStringIncludes(code, "__echo(");
  });

  it("should handle tab escaping", () => {
    const code = transpileBash(`echo "col1\\tcol2"`);
    assertStringIncludes(code, "__echo(");
  });

  it("should handle ANSI-C quoting with $'...'", () => {
    const code = transpileBash(`echo $'line1\\nline2\\ttab'`);
    assertStringIncludes(code, "__echo(");
  });

  it("should handle empty quotes", () => {
    const code = transpileBash(`echo "" '' ""`);
    assertStringIncludes(code, "__echo(");
  });
});

// =============================================================================
// Deep Nesting and Complex Control Flow
// =============================================================================

describe("Deep Nesting", () => {
  it("should handle deeply nested if statements (4 levels)", () => {
    const script = `
      if test -f level1
      then
        if test -f level2
        then
          if test -f level3
          then
            if test -f level4
            then
              echo "all exist"
            fi
          fi
        fi
      fi
    `;
    const code = transpileBash(script);
    const ifCount = (code.match(/if \(/g) || []).length;
    assert(ifCount >= 4, "Should have 4 nested if statements");
  });

  it("should handle nested loops (3 levels)", () => {
    const script = `
      for i in a b
      do
        for j in 1 2
        do
          for k in x y
          do
            echo "$i-$j-$k"
          done
        done
      done
    `;
    const code = transpileBash(script);
    const forCount = (code.match(/for \(const/g) || []).length;
    assertEquals(forCount, 3);
  });

  it("should handle mixed nested structures", () => {
    const script = `
      for i in a b
      do
        if test "$i" = "a"
        then
          while test -f lock
          do
            echo "waiting"
          done
        fi
      done
    `;
    const code = transpileBash(script);
    assertStringIncludes(code, "for (const i of");
    assertStringIncludes(code, "if (");
    assertStringIncludes(code, "while (true)");
  });

  it("should handle nested subshells", () => {
    const script = `
      (
        (
          echo "level 2"
        )
        echo "level 1"
      )
    `;
    const code = transpileBash(script);
    assertStringIncludes(code, "(async () => {");
  });
});

// =============================================================================
// Real-World CI/CD Scripts
// =============================================================================

describe("Real-World CI/CD Scripts", () => {
  it("should transpile a Docker build and push script", () => {
    const script = `
      IMAGE_NAME="myapp"
      VERSION="1.0.0"
      REGISTRY="docker.io"

      echo "Building Docker image..."
      docker build -t "$REGISTRY/$IMAGE_NAME:$VERSION" .

      if test $? -eq 0
      then
        echo "Build successful, pushing..."
        docker push "$REGISTRY/$IMAGE_NAME:$VERSION"

        if test $? -eq 0
        then
          echo "Push successful"
        else
          echo "Push failed"
          exit 1
        fi
      else
        echo "Build failed"
        exit 1
      fi
    `;
    const code = transpileBash(script);
    assertStringIncludes(code, "let IMAGE_NAME");
    assertStringIncludes(code, "let VERSION");
    assertStringIncludes(code, '"docker", "build"');
    assertStringIncludes(code, '"docker", "push"');
  });

  it("should transpile a Git tag and release script", () => {
    const script = `
      VERSION=$(cat version.txt)
      BRANCH=$(git branch --show-current)

      if test "$BRANCH" != "main"
      then
        echo "Error: Must be on main branch"
        exit 1
      fi

      git tag -a "v$VERSION" -m "Release $VERSION"
      git push origin "v$VERSION"

      echo "Released version $VERSION"
    `;
    const code = transpileBash(script);
    assertStringIncludes(code, "let VERSION");
    assertStringIncludes(code, "let BRANCH");
    assertStringIncludes(code, '"git", "tag"');
    assertStringIncludes(code, '"git", "push"');
  });

  it("should transpile a dependency check script", () => {
    const script = `
      REQUIRED_COMMANDS="git docker node npm"
      MISSING=""

      for cmd in $REQUIRED_COMMANDS
      do
        if ! command -v "$cmd"
        then
          MISSING="$MISSING $cmd"
        fi
      done

      if test -n "$MISSING"
      then
        echo "Missing required commands:$MISSING"
        exit 1
      fi

      echo "All dependencies satisfied"
    `;
    const code = transpileBash(script);
    assertStringIncludes(code, "for (const cmd of");
    assertStringIncludes(code, '"command", "-v"');
  });

  it("should transpile a test runner script", () => {
    const script = `
      TEST_DIRS="unit integration e2e"
      FAILED=0

      for dir in $TEST_DIRS
      do
        echo "Running $dir tests..."

        if test -d "tests/$dir"
        then
          npm test "tests/$dir"

          if test $? -ne 0
          then
            FAILED=$((FAILED + 1))
            echo "FAIL: $dir tests"
          else
            echo "PASS: $dir tests"
          fi
        fi
      done

      if test $FAILED -gt 0
      then
        echo "$FAILED test suites failed"
        exit 1
      fi

      echo "All tests passed"
    `;
    const code = transpileBash(script);
    assertStringIncludes(code, "for (const dir of");
    assertStringIncludes(code, '"npm", "test"');
  });
});

// =============================================================================
// Real-World Deployment Scripts
// =============================================================================

describe("Real-World Deployment Scripts", () => {
  it("should transpile a blue-green deployment script", () => {
    const script = `
      CURRENT=$(cat /var/app/current)

      if test "$CURRENT" = "blue"
      then
        TARGET="green"
      else
        TARGET="blue"
      fi

      echo "Deploying to $TARGET environment..."

      rsync -av build/ "/var/app/$TARGET/"

      echo "Testing $TARGET environment..."
      curl -f "http://localhost:8080/$TARGET/health"

      if test $? -eq 0
      then
        echo "$TARGET" > /var/app/current
        echo "Switched to $TARGET"
      else
        echo "Health check failed, keeping $CURRENT"
        exit 1
      fi
    `;
    const code = transpileBash(script);
    assertStringIncludes(code, "let CURRENT");
    assertStringIncludes(code, "let TARGET");
    assertStringIncludes(code, "rsync");
    assertStringIncludes(code, "curl");
  });

  it("should transpile a database migration script", () => {
    const script = `
      DB_HOST="localhost"
      DB_NAME="mydb"
      BACKUP_DIR="/backups"
      TIMESTAMP=$(date +%Y%m%d_%H%M%S)

      echo "Creating backup..."
      pg_dump -h "$DB_HOST" "$DB_NAME" > "$BACKUP_DIR/backup_$TIMESTAMP.sql"

      if test $? -eq 0
      then
        echo "Backup created successfully"
        echo "Running migrations..."

        for migration in migrations/*.sql
        do
          echo "Applying $migration"
          psql -h "$DB_HOST" "$DB_NAME" < "$migration"

          if test $? -ne 0
          then
            echo "Migration failed: $migration"
            echo "Restoring from backup..."
            psql -h "$DB_HOST" "$DB_NAME" < "$BACKUP_DIR/backup_$TIMESTAMP.sql"
            exit 1
          fi
        done

        echo "All migrations applied successfully"
      else
        echo "Backup failed, aborting"
        exit 1
      fi
    `;
    const code = transpileBash(script);
    assertStringIncludes(code, "pg_dump");
    assertStringIncludes(code, "psql");
    assertStringIncludes(code, "for (const migration of");
  });

  it("should transpile a rolling restart script", () => {
    const script = `
      SERVERS="server1 server2 server3"

      for server in $SERVERS
      do
        echo "Restarting $server..."

        ssh "$server" "systemctl restart app.service"

        if test $? -ne 0
        then
          echo "Failed to restart $server"
          exit 1
        fi

        echo "Waiting for $server to be healthy..."
        RETRIES=0
        MAX_RETRIES=30

        while test $RETRIES -lt $MAX_RETRIES
        do
          if curl -f "http://$server:8080/health"
          then
            echo "$server is healthy"
            break
          fi

          RETRIES=$((RETRIES + 1))
          sleep 2
        done

        if test $RETRIES -eq $MAX_RETRIES
        then
          echo "$server failed health check"
          exit 1
        fi
      done

      echo "All servers restarted successfully"
    `;
    const code = transpileBash(script);
    assertStringIncludes(code, "for (const server of");
    assertStringIncludes(code, "ssh");
    assertStringIncludes(code, "while (true)");
  });
});

// =============================================================================
// Real-World Monitoring Scripts
// =============================================================================

describe("Real-World Monitoring Scripts", () => {
  it("should transpile a disk usage monitor", () => {
    const script = `
      THRESHOLD=80
      ALERT_EMAIL="admin@example.com"

      df -h | tail -n +2 | while read line
      do
        usage=$(echo "$line" | awk '{print $5}' | sed 's/%//')
        mount=$(echo "$line" | awk '{print $6}')

        if test "$usage" -gt "$THRESHOLD"
        then
          echo "ALERT: $mount is at $usage% usage"
          echo "Disk usage alert: $mount is at $usage%" | mail -s "Disk Alert" "$ALERT_EMAIL"
        fi
      done
    `;
    const code = transpileBash(script);
    assertStringIncludes(code, "df");
    assertStringIncludes(code, "while (true)");
  });

  it("should transpile a process monitor", () => {
    const script = `
      PROCESS_NAME="myapp"
      LOG_FILE="/var/log/monitor.log"

      while true
      do
        if ! pgrep -f "$PROCESS_NAME"
        then
          echo "$(date): Process $PROCESS_NAME not running, restarting..." >> "$LOG_FILE"
          systemctl restart "$PROCESS_NAME"
          sleep 5

          if pgrep -f "$PROCESS_NAME"
          then
            echo "$(date): Process $PROCESS_NAME restarted successfully" >> "$LOG_FILE"
          else
            echo "$(date): Failed to restart $PROCESS_NAME" >> "$LOG_FILE"
          fi
        fi

        sleep 60
      done
    `;
    const code = transpileBash(script);
    assertStringIncludes(code, "while (true)");
    assertStringIncludes(code, "pgrep");
  });

  it("should transpile a log rotation script", () => {
    const script = `
      LOG_DIR="/var/log/app"
      MAX_SIZE=100000000
      KEEP_DAYS=7

      for log in "$LOG_DIR"/*.log
      do
        if test -f "$log"
        then
          SIZE=$(stat -f%z "$log")

          if test "$SIZE" -gt "$MAX_SIZE"
          then
            TIMESTAMP=$(date +%Y%m%d_%H%M%S)
            gzip -c "$log" > "$log.$TIMESTAMP.gz"
            echo "" > "$log"
            echo "Rotated $log"
          fi
        fi
      done

      find "$LOG_DIR" -name "*.gz" -mtime +"$KEEP_DAYS" -delete
      echo "Cleaned up logs older than $KEEP_DAYS days"
    `;
    const code = transpileBash(script);
    assertStringIncludes(code, "for (const log of");
    assertStringIncludes(code, "gzip");
    assertStringIncludes(code, "find");
  });
});

// =============================================================================
// Complex Parameter Expansions
// =============================================================================

describe("Complex Parameter Expansions", () => {
  it("should handle multiple expansions in one word", () => {
    const code = transpileBash('echo "${VAR1:-default1}_${VAR2:-default2}"');
    assertStringIncludes(code, "VAR1");
    assertStringIncludes(code, "VAR2");
  });

  it("should handle nested parameter expansions", () => {
    const code = transpileBash('echo "${VAR:-${DEFAULT:-fallback}}"');
    assertStringIncludes(code, "VAR");
    assertStringIncludes(code, "DEFAULT");
  });

  it("should handle expansion with pattern and replacement", () => {
    const code = transpileBash('echo "${PATH//:/;}"');
    assertStringIncludes(code, "PATH");
    assertStringIncludes(code, ".replaceAll");
  });

  it("should handle multiple modifiers", () => {
    const code = transpileBash('FILE="${1:-default.txt}"; echo "${FILE%.txt}.bak"');
    assertStringIncludes(code, "let FILE");
    assertStringIncludes(code, ".replace(");
  });

  it("should handle expansion in arithmetic", () => {
    const code = transpileBash('echo $((${COUNT:-0} + 1))');
    assertStringIncludes(code, "COUNT");
  });
});

// =============================================================================
// Complex Arithmetic Expressions
// =============================================================================

describe("Complex Arithmetic", () => {
  it("should handle complex arithmetic with multiple operators", () => {
    const code = transpileBash("echo $(((a + b) * c / d - e % f))");
    assertStringIncludes(code, "+");
    assertStringIncludes(code, "*");
    assertStringIncludes(code, "/");
    assertStringIncludes(code, "-");
    assertStringIncludes(code, "%");
  });

  it("should handle bitwise operations combined", () => {
    const code = transpileBash("echo $(((a & b) | (c ^ d)))");
    assertStringIncludes(code, "&");
    assertStringIncludes(code, "|");
    assertStringIncludes(code, "^");
  });

  it("should handle complex ternary expressions", () => {
    const code = transpileBash("echo $((a > b ? (c > d ? c : d) : b))");
    assertStringIncludes(code, "?");
    assertStringIncludes(code, ":");
  });

  it("should handle arithmetic with variables and literals", () => {
    const code = transpileBash("result=$((var1 * 100 + var2 / 10 - 5))");
    assertStringIncludes(code, "let result");
    assertStringIncludes(code, "var1");
    assertStringIncludes(code, "var2");
  });
});

// =============================================================================
// Complex Test Expressions
// =============================================================================

describe("Complex Test Expressions", () => {
  it("should handle deeply nested logical expressions", () => {
    const code = transpileBash("[[ ( -f file1 && -r file1 ) || ( -f file2 && -r file2 ) ]]");
    assertStringIncludes(code, "&&");
    assertStringIncludes(code, "||");
  });

  it("should handle negation of complex expressions", () => {
    const code = transpileBash("[[ ! ( -f file && -x file ) ]]");
    assertStringIncludes(code, "!(");
  });

  it("should handle multiple string comparisons", () => {
    const code = transpileBash('[[ "$a" == "$b" && "$c" != "$d" ]]');
    assertStringIncludes(code, "===");
    assertStringIncludes(code, "!==");
  });

  it("should handle mixed file and string tests", () => {
    const code = transpileBash('[[ -f "$FILE" && "$STATUS" == "ready" ]]');
    assertStringIncludes(code, "$.fs.stat");
    assertStringIncludes(code, "===");
  });
});

// =============================================================================
// Edge Cases
// =============================================================================

describe("Edge Cases", () => {
  it("should handle empty script", () => {
    const code = transpileBash("");
    assertStringIncludes(code, "(async () => {");
  });

  it("should handle only comments", () => {
    const code = transpileBash("# just a comment");
    assertStringIncludes(code, "(async () => {");
  });

  it("should handle very long variable names", () => {
    const varName = "VERY_LONG_VARIABLE_NAME_THAT_GOES_ON_AND_ON";
    const code = transpileBash(`${varName}=value; echo "$${varName}"`);
    assertStringIncludes(code, varName);
  });

  it("should handle special characters in variable values", () => {
    const code = transpileBash('VAR="$@#%^&*()"');
    assertStringIncludes(code, "let VAR");
  });

  it("should handle commands with no arguments", () => {
    const code = transpileBash("pwd");
    assertStringIncludes(code, "__pwd(");
  });

  it("should handle multiple redirections", () => {
    const code = transpileBash("command < in.txt > out.txt 2> err.txt");
    assertStringIncludes(code, ".stdin(");
    assertStringIncludes(code, ".stdout(");
    assertStringIncludes(code, ".stderr(");
  });
});

// =============================================================================
// Stress Tests
// =============================================================================

describe("Stress Tests", () => {
  it("should handle very long pipeline", () => {
    const pipeline = Array(10).fill("grep pattern").join(" | ");
    const code = transpileBash(pipeline);
    assertStringIncludes(code, ".pipe(");
  });

  it("should handle many variable assignments", () => {
    const assignments = Array(50).fill(0)
      .map((_, i) => `VAR${i}=value${i}`)
      .join("\n");
    const code = transpileBash(assignments);
    assertStringIncludes(code, "let VAR0");
    assertStringIncludes(code, "let VAR49");
  });

  it("should handle long for loop with many items", () => {
    const items = Array(100).fill(0).map((_, i) => `item${i}`).join(" ");
    const code = transpileBash(`for i in ${items}; do echo "$i"; done`);
    assertStringIncludes(code, "for (const i of");
  });
});

// =============================================================================
// Maintenance and Utility Scripts
// =============================================================================

describe("Maintenance Scripts", () => {
  it("should transpile a cleanup script", () => {
    const script = `
      TEMP_DIR="/tmp/build"
      LOG_DIR="/var/log/app"
      MAX_AGE=7

      echo "Cleaning up temporary files..."

      if test -d "$TEMP_DIR"
      then
        find "$TEMP_DIR" -type f -mtime +$MAX_AGE -delete
        echo "Cleaned $TEMP_DIR"
      fi

      if test -d "$LOG_DIR"
      then
        find "$LOG_DIR" -name "*.log" -mtime +$MAX_AGE -delete
        echo "Cleaned $LOG_DIR"
      fi

      echo "Cleanup complete"
    `;
    const code = transpileBash(script);
    assertStringIncludes(code, "find");
    assertStringIncludes(code, "if (");
  });

  it("should transpile a backup script with rotation", () => {
    const script = `
      SOURCE="/var/www/app"
      BACKUP_DIR="/backups"
      DATE=$(date +%Y%m%d)
      KEEP=5

      tar czf "$BACKUP_DIR/backup_$DATE.tar.gz" "$SOURCE"

      if test $? -eq 0
      then
        echo "Backup created: backup_$DATE.tar.gz"

        COUNT=$(ls -1 "$BACKUP_DIR"/backup_*.tar.gz | wc -l)

        if test "$COUNT" -gt "$KEEP"
        then
          ls -1t "$BACKUP_DIR"/backup_*.tar.gz | tail -n +$((KEEP + 1)) | xargs rm
          echo "Rotated old backups"
        fi
      else
        echo "Backup failed"
        exit 1
      fi
    `;
    const code = transpileBash(script);
    assertStringIncludes(code, "tar");
    assertStringIncludes(code, "let COUNT");
  });
});
