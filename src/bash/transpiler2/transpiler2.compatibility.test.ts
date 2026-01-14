/**
 * Bash Compatibility Test Suite for transpiler2
 *
 * Tests real-world bash patterns from production scripts including:
 * - Package manager scripts (npm, apt, yum)
 * - Build scripts (make, gradle, maven)
 * - Init scripts (systemd, init.d)
 * - Docker entrypoint scripts
 * - Kubernetes scripts (kubectl, helm)
 * - AWS CLI scripts
 * - Git hooks
 * - Cron job scripts
 * - Shell rc files (bashrc, profile)
 * - Common utility patterns
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { parse } from "../parser.ts";
import { transpile } from "./mod.ts";

// Helper function to transpile bash code
function transpileBash(bash: string): string {
  const ast = parse(bash);
  return transpile(ast);
}

// =============================================================================
// 1. Package Manager Scripts (npm, apt, yum)
// =============================================================================

describe("Package Manager Scripts", () => {
  describe("npm scripts", () => {
    it("should handle npm install with fallback", () => {
      const code = transpileBash(`
        npm install || npm install --force
      `);
      assertStringIncludes(code, "npm install");
    });

    it("should handle npm version check and conditional install", () => {
      const code = transpileBash(`
        if [ ! -d "node_modules" ]; then
          npm install
        fi
      `);
      assertStringIncludes(code, "node_modules");
      assertStringIncludes(code, "npm install");
    });

    it("should handle npm run with environment variables", () => {
      const code = transpileBash(`
        NODE_ENV=production npm run build
      `);
      assertStringIncludes(code, 'NODE_ENV: "production"');
      assertStringIncludes(code, '"npm", "run", "build"');
    });

    it("should handle package.json script pattern", () => {
      const code = transpileBash(`
        npm run clean && npm run build && npm test
      `);
      assertStringIncludes(code, "npm run clean");
      assertStringIncludes(code, "npm run build");
      assertStringIncludes(code, "npm test");
    });
  });

  describe("apt scripts", () => {
    it("should handle apt-get update and install", () => {
      const code = transpileBash(`
        apt-get update && apt-get install -y curl wget
      `);
      assertStringIncludes(code, "apt-get update");
      assertStringIncludes(code, "apt-get install");
    });

    it("should handle apt with DEBIAN_FRONTEND", () => {
      const code = transpileBash(`
        DEBIAN_FRONTEND=noninteractive apt-get install -y package
      `);
      assertStringIncludes(code, 'DEBIAN_FRONTEND: "noninteractive"');
      assertStringIncludes(code, '"apt-get", "install"');
    });

    it("should handle apt cleanup pattern", () => {
      const code = transpileBash(`
        apt-get clean && rm -rf /var/lib/apt/lists/*
      `);
      assertStringIncludes(code, "apt-get clean");
      assertStringIncludes(code, "rm");
    });
  });

  describe("yum scripts", () => {
    it("should handle yum install", () => {
      const code = transpileBash(`
        yum install -y epel-release && yum update -y
      `);
      assertStringIncludes(code, "yum install");
      assertStringIncludes(code, "yum update");
    });

    it("should handle yum with package groups", () => {
      const code = transpileBash(`
        yum groupinstall -y "Development Tools"
      `);
      assertStringIncludes(code, "yum groupinstall");
    });
  });
});

// =============================================================================
// 2. Build Scripts (make, gradle, maven)
// =============================================================================

describe("Build Scripts", () => {
  describe("make patterns", () => {
    it("should handle make with targets", () => {
      const code = transpileBash(`
        make clean && make all && make install
      `);
      assertStringIncludes(code, "make clean");
      assertStringIncludes(code, "make all");
      assertStringIncludes(code, "make install");
    });

    it("should handle make with variables", () => {
      const code = transpileBash(`
        make CC=gcc PREFIX=/usr/local install
      `);
      assertStringIncludes(code, "make");
    });

    it("should handle parallel make", () => {
      const code = transpileBash(`
        make -j$(nproc)
      `);
      assertStringIncludes(code, "make");
      assertStringIncludes(code, "nproc");
    });
  });

  describe("gradle patterns", () => {
    it("should handle gradle build", () => {
      const code = transpileBash(`
        ./gradlew clean build
      `);
      assertStringIncludes(code, "gradlew clean build");
    });

    it("should handle gradle with test skip", () => {
      const code = transpileBash(`
        ./gradlew build -x test
      `);
      assertStringIncludes(code, "gradlew build");
    });
  });

  describe("maven patterns", () => {
    it("should handle maven clean install", () => {
      const code = transpileBash(`
        mvn clean install -DskipTests
      `);
      assertStringIncludes(code, "mvn clean install");
    });

    it("should handle maven with profiles", () => {
      const code = transpileBash(`
        mvn clean package -P production
      `);
      assertStringIncludes(code, "mvn clean package");
    });
  });
});

// =============================================================================
// 3. Init Scripts (systemd, init.d)
// =============================================================================

describe("Init Scripts", () => {
  describe("systemd patterns", () => {
    it("should handle systemctl commands", () => {
      const code = transpileBash(`
        systemctl start myservice
        systemctl enable myservice
        systemctl status myservice
      `);
      assertStringIncludes(code, "systemctl start");
      assertStringIncludes(code, "systemctl enable");
      assertStringIncludes(code, "systemctl status");
    });

    it("should handle service restart with check", () => {
      const code = transpileBash(`
        if systemctl is-active --quiet myservice; then
          systemctl restart myservice
        else
          systemctl start myservice
        fi
      `);
      assertStringIncludes(code, "systemctl is-active");
      assertStringIncludes(code, "systemctl restart");
    });
  });

  describe("init.d patterns", () => {
    it("should handle init.d script structure", () => {
      const code = transpileBash(`
        case "$1" in
          start)
            echo "Starting service"
            ;;
          stop)
            echo "Stopping service"
            ;;
          restart)
            echo "Restarting service"
            ;;
          *)
            echo "Usage: $0 {start|stop|restart}"
            exit 1
            ;;
        esac
      `);
      // Transpiler converts case to if/else if chains
      assertStringIncludes(code, "if (");
      assertStringIncludes(code, "else if (");
      assertStringIncludes(code, "start");
      assertStringIncludes(code, "stop");
      assertStringIncludes(code, "restart");
    });

    it("should handle pidfile management", () => {
      const code = transpileBash(`
        PIDFILE=/var/run/myservice.pid
        if [ -f "$PIDFILE" ]; then
          kill $(cat "$PIDFILE")
          rm -f "$PIDFILE"
        fi
      `);
      assertStringIncludes(code, "PIDFILE");
      assertStringIncludes(code, "kill");
    });
  });
});

// =============================================================================
// 4. Docker Entrypoint Scripts
// =============================================================================

describe("Docker Entrypoint Scripts", () => {
  it("should handle basic entrypoint pattern", () => {
    const code = transpileBash(`
      #!/bin/bash
      set -e

      if [ "$1" = 'myapp' ]; then
        exec gosu myuser "$@"
      fi

      exec "$@"
    `);
    assertStringIncludes(code, "set");
    assertStringIncludes(code, "exec");
  });

  it("should handle environment variable defaults", () => {
    const code = transpileBash(`
      export DB_HOST=\${DB_HOST:-localhost}
      export DB_PORT=\${DB_PORT:-5432}
      export DEBUG=\${DEBUG:-false}
    `);
    assertStringIncludes(code, "DB_HOST");
    assertStringIncludes(code, "DB_PORT");
    assertStringIncludes(code, "DEBUG");
  });

  it("should handle wait-for-it pattern", () => {
    const code = transpileBash(`
      until nc -z database 5432; do
        echo "Waiting for database..."
        sleep 1
      done
      echo "Database is ready!"
    `);
    // Transpiler converts until to while loops
    assertStringIncludes(code, "while (");
    assertStringIncludes(code, "nc");
    assertStringIncludes(code, "sleep");
  });

  it("should handle signal handling", () => {
    const code = transpileBash(`
      trap 'kill -TERM $PID' TERM INT
      myapp &
      PID=$!
      wait $PID
    `);
    assertStringIncludes(code, "trap");
    assertStringIncludes(code, "wait");
  });

  it("should handle file permission setup", () => {
    const code = transpileBash(`
      chown -R myuser:mygroup /app/data
      chmod 755 /app/bin/*
    `);
    assertStringIncludes(code, "chown");
    assertStringIncludes(code, "chmod");
  });
});

// =============================================================================
// 5. Kubernetes Scripts (kubectl, helm)
// =============================================================================

describe("Kubernetes Scripts", () => {
  describe("kubectl patterns", () => {
    it("should handle kubectl apply", () => {
      const code = transpileBash(`
        kubectl apply -f deployment.yaml
        kubectl rollout status deployment/myapp
      `);
      assertStringIncludes(code, "kubectl apply");
      assertStringIncludes(code, "kubectl rollout");
    });

    it("should handle kubectl with namespace", () => {
      const code = transpileBash(`
        NAMESPACE=production
        kubectl get pods -n $NAMESPACE
      `);
      assertStringIncludes(code, "NAMESPACE");
      assertStringIncludes(code, "kubectl get pods");
    });

    it("should handle kubectl wait pattern", () => {
      const code = transpileBash(`
        kubectl wait --for=condition=ready pod -l app=myapp --timeout=300s
      `);
      assertStringIncludes(code, "kubectl wait");
    });

    it("should handle kubectl logs with follow", () => {
      const code = transpileBash(`
        kubectl logs -f deployment/myapp | grep ERROR
      `);
      assertStringIncludes(code, "kubectl logs");
      assertStringIncludes(code, ".pipe(");
    });
  });

  describe("helm patterns", () => {
    it("should handle helm install", () => {
      const code = transpileBash(`
        helm install myapp ./chart --values values.yaml
      `);
      assertStringIncludes(code, "helm install");
    });

    it("should handle helm upgrade with rollback", () => {
      const code = transpileBash(`
        helm upgrade myapp ./chart || helm rollback myapp
      `);
      assertStringIncludes(code, "helm upgrade");
      assertStringIncludes(code, "helm rollback");
    });

    it("should handle helm template validation", () => {
      const code = transpileBash(`
        helm template myapp ./chart | kubectl apply --dry-run=client -f -
      `);
      assertStringIncludes(code, "helm template");
      assertStringIncludes(code, ".pipe(");
    });
  });
});

// =============================================================================
// 6. AWS CLI Scripts
// =============================================================================

describe("AWS CLI Scripts", () => {
  it("should handle aws s3 sync", () => {
    const code = transpileBash(`
      aws s3 sync ./build s3://my-bucket/path --delete
    `);
    assertStringIncludes(code, "aws s3 sync");
  });

  it("should handle aws with profile and region", () => {
    const code = transpileBash(`
      AWS_PROFILE=production AWS_REGION=us-west-2 aws ec2 describe-instances
    `);
    assertStringIncludes(code, 'AWS_PROFILE: "production"');
    assertStringIncludes(code, 'AWS_REGION: "us-west-2"');
    assertStringIncludes(code, '"aws", "ec2"');
  });

  it("should handle aws ecr login", () => {
    const code = transpileBash(`
      aws ecr get-login-password --region us-west-2 | docker login --username AWS --password-stdin 123456789.dkr.ecr.us-west-2.amazonaws.com
    `);
    assertStringIncludes(code, "aws ecr");
    assertStringIncludes(code, ".pipe(");
    assertStringIncludes(code, "docker login");
  });

  it("should handle aws with jq processing", () => {
    const code = transpileBash(`
      aws ec2 describe-instances | jq '.Reservations[].Instances[].InstanceId'
    `);
    assertStringIncludes(code, "aws ec2");
    assertStringIncludes(code, ".pipe(");
  });

  it("should handle aws cloudformation deploy", () => {
    const code = transpileBash(`
      aws cloudformation deploy \\
        --template-file template.yaml \\
        --stack-name my-stack \\
        --capabilities CAPABILITY_IAM
    `);
    assertStringIncludes(code, "aws cloudformation");
  });

  it("should handle aws parameter store", () => {
    const code = transpileBash(`
      SECRET=$(aws ssm get-parameter --name /prod/db/password --with-decryption --query Parameter.Value --output text)
    `);
    assertStringIncludes(code, "SECRET");
    assertStringIncludes(code, "aws ssm");
  });
});

// =============================================================================
// 7. Git Hooks
// =============================================================================

describe("Git Hooks", () => {
  describe("pre-commit hooks", () => {
    it("should handle lint check pattern", () => {
      const code = transpileBash(`
        FILES=$(git diff --cached --name-only --diff-filter=ACMR | grep '\\.js$')
        if [ -n "$FILES" ]; then
          eslint $FILES
        fi
      `);
      assertStringIncludes(code, "FILES");
      assertStringIncludes(code, "git diff");
      assertStringIncludes(code, "eslint");
    });

    it("should handle test runner in pre-commit", () => {
      const code = transpileBash(`
        npm test || {
          echo "Tests failed. Commit aborted."
          exit 1
        }
      `);
      assertStringIncludes(code, "npm test");
      assertStringIncludes(code, "exit");
    });
  });

  describe("post-receive hooks", () => {
    it("should handle deployment hook", () => {
      const code = transpileBash(`
        while read oldrev newrev refname; do
          if [ "$refname" = "refs/heads/main" ]; then
            cd /var/www/app
            git pull origin main
            npm install
            npm run build
            systemctl restart myapp
          fi
        done
      `);
      assertStringIncludes(code, "while");
      assertStringIncludes(code, "read");
      assertStringIncludes(code, "git pull");
    });
  });

  describe("pre-push hooks", () => {
    it("should handle branch protection", () => {
      const code = transpileBash(`
        BRANCH=$(git rev-parse --abbrev-ref HEAD)
        if [ "$BRANCH" = "main" ]; then
          echo "Direct push to main is not allowed"
          exit 1
        fi
      `);
      assertStringIncludes(code, "BRANCH");
      assertStringIncludes(code, "git rev-parse");
    });
  });
});

// =============================================================================
// 8. Cron Job Scripts
// =============================================================================

describe("Cron Job Scripts", () => {
  it("should handle log rotation pattern", () => {
    const code = transpileBash(`
      find /var/log/myapp -name "*.log" -mtime +7 -delete
    `);
    assertStringIncludes(code, "find");
  });

  it("should handle backup script pattern", () => {
    const code = transpileBash(`
      DATE=$(date +%Y%m%d)
      BACKUP_FILE=/backup/db-$DATE.sql
      pg_dump mydb > $BACKUP_FILE
      gzip $BACKUP_FILE
    `);
    assertStringIncludes(code, "DATE");
    assertStringIncludes(code, "date");
    assertStringIncludes(code, "pg_dump");
    assertStringIncludes(code, "gzip");
  });

  it("should handle cron with locking", () => {
    const code = transpileBash(`
      LOCKFILE=/var/lock/myjob.lock
      if [ -e "$LOCKFILE" ]; then
        echo "Job already running"
        exit 0
      fi
      touch $LOCKFILE
      trap "rm -f $LOCKFILE" EXIT
      # do work here
    `);
    assertStringIncludes(code, "LOCKFILE");
    assertStringIncludes(code, "trap");
  });

  it("should handle maintenance window check", () => {
    const code = transpileBash(`
      HOUR=$(date +%H)
      if [ $HOUR -ge 2 ] && [ $HOUR -le 4 ]; then
        echo "Running maintenance"
        # maintenance tasks
      fi
    `);
    assertStringIncludes(code, "HOUR");
    assertStringIncludes(code, "date");
  });

  it("should handle cleanup with retention", () => {
    const code = transpileBash(`
      find /tmp/cache -type f -mtime +1 -delete
      find /var/log/app -name "*.log.gz" -mtime +30 -delete
    `);
    assertStringIncludes(code, "find");
  });
});

// =============================================================================
// 9. Shell RC Files (bashrc, profile)
// =============================================================================

describe("Shell RC Files", () => {
  it("should handle PATH modification", () => {
    const code = transpileBash(`
      export PATH="$HOME/bin:$PATH"
      export PATH="/usr/local/bin:$PATH"
    `);
    assertStringIncludes(code, "PATH");
  });

  it("should handle alias definitions", () => {
    const code = transpileBash(`
      alias ll='ls -la'
      alias gs='git status'
      alias gp='git pull'
    `);
    assertStringIncludes(code, "alias");
  });

  it("should handle shell options", () => {
    const code = transpileBash(`
      shopt -s histappend
      shopt -s checkwinsize
    `);
    assertStringIncludes(code, "shopt");
  });

  it("should handle prompt customization", () => {
    const code = transpileBash(`
      export PS1='\\u@\\h:\\w\\$ '
    `);
    assertStringIncludes(code, "PS1");
  });

  it("should handle conditional sourcing", () => {
    const code = transpileBash(`
      if [ -f ~/.bash_aliases ]; then
        source ~/.bash_aliases
      fi
    `);
    assertStringIncludes(code, "source");
  });

  it("should handle environment detection", () => {
    const code = transpileBash(`
      if [ -n "$SSH_CLIENT" ]; then
        export IS_REMOTE=true
      fi
    `);
    assertStringIncludes(code, "SSH_CLIENT");
    assertStringIncludes(code, "IS_REMOTE");
  });
});

// =============================================================================
// 10. Common Utility Patterns
// =============================================================================

describe("Common Utility Patterns", () => {
  describe("error handling", () => {
    it("should handle set -e pattern", () => {
      const code = transpileBash(`
        set -e
        set -u
        set -o pipefail
      `);
      assertStringIncludes(code, "set");
    });

    it("should handle error function pattern", () => {
      const code = transpileBash(`
        error() {
          echo "ERROR: $*" >&2
          exit 1
        }

        [ -f required_file ] || error "File not found"
      `);
      assertStringIncludes(code, "function error");
      assertStringIncludes(code, "exit");
    });
  });

  describe("argument parsing", () => {
    it("should handle getopts pattern", () => {
      const code = transpileBash(`
        while getopts "hvf:" opt; do
          case $opt in
            h) show_help ;;
            v) VERBOSE=1 ;;
            f) FILE=$OPTARG ;;
          esac
        done
      `);
      assertStringIncludes(code, "getopts");
      // Transpiler converts case to if/else if chains
      assertStringIncludes(code, "if (");
      assertStringIncludes(code, "else if (");
    });

    it("should handle positional argument parsing", () => {
      const code = transpileBash(`
        if [ $# -lt 2 ]; then
          echo "Usage: $0 <source> <dest>"
          exit 1
        fi
        SOURCE=$1
        DEST=$2
      `);
      assertStringIncludes(code, "SOURCE");
      assertStringIncludes(code, "DEST");
    });
  });

  describe("array operations", () => {
    it("should handle array iteration", () => {
      const code = transpileBash(`
        SERVERS=("web1" "web2" "web3")
        for server in "\${SERVERS[@]}"; do
          ssh "$server" uptime
        done
      `);
      assertStringIncludes(code, "SERVERS");
      assertStringIncludes(code, "for");
    });

    it("should handle array length check", () => {
      const code = transpileBash(`
        FILES=(*.txt)
        if [ \${#FILES[@]} -eq 0 ]; then
          echo "No files found"
        fi
      `);
      assertStringIncludes(code, "FILES");
    });
  });

  describe("string operations", () => {
    it("should handle string replacement", () => {
      const code = transpileBash(`
        FILE="document.txt"
        BASENAME=\${FILE%.txt}
        NEWFILE=\${BASENAME}.pdf
      `);
      assertStringIncludes(code, "FILE");
      assertStringIncludes(code, "BASENAME");
    });

    it("should handle string length", () => {
      const code = transpileBash(`
        TEXT="hello world"
        LENGTH=\${#TEXT}
      `);
      assertStringIncludes(code, "TEXT");
      assertStringIncludes(code, "LENGTH");
    });

    it("should handle substring extraction", () => {
      const code = transpileBash(`
        TEXT="hello world"
        SUBSTR=\${TEXT:0:5}
      `);
      assertStringIncludes(code, "TEXT");
      assertStringIncludes(code, "SUBSTR");
    });
  });

  describe("file operations", () => {
    it("should handle directory existence check", () => {
      const code = transpileBash(`
        [ -d "/path/to/dir" ] || mkdir -p /path/to/dir
      `);
      assertStringIncludes(code, "mkdir");
    });

    it("should handle file copying with backup", () => {
      const code = transpileBash(`
        if [ -f target ]; then
          cp target target.bak
        fi
        cp source target
      `);
      assertStringIncludes(code, "cp");
    });

    it("should handle recursive file processing", () => {
      const code = transpileBash(`
        find . -name "*.js" -type f -exec sed -i 's/var /let /g' {} \\;
      `);
      assertStringIncludes(code, "find");
    });
  });

  describe("process management", () => {
    it("should handle process check and restart", () => {
      const code = transpileBash(`
        if ! pgrep -f myapp > /dev/null; then
          echo "Starting myapp"
          /usr/bin/myapp &
        fi
      `);
      assertStringIncludes(code, "pgrep");
    });

    it("should handle wait for process completion", () => {
      const code = transpileBash(`
        long_running_task &
        PID=$!
        wait $PID
        echo "Task completed with status $?"
      `);
      assertStringIncludes(code, "PID");
      assertStringIncludes(code, "wait");
    });
  });

  describe("network operations", () => {
    it("should handle curl with retry", () => {
      const code = transpileBash(`
        curl --retry 3 --retry-delay 5 https://api.example.com/data
      `);
      assertStringIncludes(code, "curl");
    });

    it("should handle wget with output", () => {
      const code = transpileBash(`
        wget -O /tmp/file.tar.gz https://example.com/file.tar.gz
      `);
      assertStringIncludes(code, "wget");
    });

    it("should handle health check loop", () => {
      const code = transpileBash(`
        for i in {1..30}; do
          if curl -sf http://localhost:8080/health; then
            echo "Service is healthy"
            break
          fi
          sleep 2
        done
      `);
      assertStringIncludes(code, "curl");
      assertStringIncludes(code, "sleep");
    });
  });

  describe("logging patterns", () => {
    it("should handle log function", () => {
      const code = transpileBash(`
        log() {
          echo "[$(date +'%Y-%m-%d %H:%M:%S')] $*"
        }

        log "Application started"
      `);
      assertStringIncludes(code, "function log");
      assertStringIncludes(code, "date");
    });

    it("should handle stdout and stderr redirection", () => {
      const code = transpileBash(`
        command > output.log 2> error.log
      `);
      assertStringIncludes(code, "command");
    });

    it("should handle combined output redirection", () => {
      const code = transpileBash(`
        command &> combined.log
      `);
      assertStringIncludes(code, "command");
    });
  });

  describe("configuration management", () => {
    it("should handle config file sourcing", () => {
      const code = transpileBash(`
        CONFIG_FILE=/etc/myapp/config
        if [ -f "$CONFIG_FILE" ]; then
          source "$CONFIG_FILE"
        else
          echo "Config file not found"
          exit 1
        fi
      `);
      assertStringIncludes(code, "CONFIG_FILE");
      assertStringIncludes(code, "source");
    });

    it("should handle environment defaults", () => {
      const code = transpileBash(`
        : \${PORT:=8080}
        : \${HOST:=localhost}
        : \${DEBUG:=false}
      `);
      assertStringIncludes(code, "PORT");
      assertStringIncludes(code, "HOST");
      assertStringIncludes(code, "DEBUG");
    });
  });

  describe("temporary file handling", () => {
    it("should handle mktemp pattern", () => {
      const code = transpileBash(`
        TMPFILE=$(mktemp)
        trap "rm -f $TMPFILE" EXIT
        echo "data" > $TMPFILE
      `);
      assertStringIncludes(code, "TMPFILE");
      assertStringIncludes(code, "mktemp");
      assertStringIncludes(code, "trap");
    });

    it("should handle temporary directory", () => {
      const code = transpileBash(`
        TMPDIR=$(mktemp -d)
        trap "rm -rf $TMPDIR" EXIT
      `);
      assertStringIncludes(code, "TMPDIR");
      assertStringIncludes(code, "mktemp");
    });
  });

  describe("user interaction", () => {
    it("should handle user confirmation", () => {
      const code = transpileBash(`
        read -p "Are you sure? (y/n) " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
          echo "Confirmed"
        fi
      `);
      assertStringIncludes(code, "read");
      assertStringIncludes(code, "REPLY");
    });

    it("should handle password input", () => {
      const code = transpileBash(`
        read -sp "Enter password: " PASSWORD
        echo
      `);
      assertStringIncludes(code, "read");
      assertStringIncludes(code, "PASSWORD");
    });
  });

  describe("parallel execution", () => {
    it("should handle background jobs with wait", () => {
      const code = transpileBash(`
        task1 &
        task2 &
        task3 &
        wait
        echo "All tasks completed"
      `);
      assertStringIncludes(code, "task1");
      assertStringIncludes(code, "task2");
      assertStringIncludes(code, "task3");
      assertStringIncludes(code, "wait");
    });

    it("should handle xargs parallel", () => {
      const code = transpileBash(`
        cat urls.txt | xargs -P 4 -I {} curl -O {}
      `);
      assertStringIncludes(code, ".pipe(");
      assertStringIncludes(code, "xargs");
    });
  });

  describe("exit code handling", () => {
    it("should handle exit code checking", () => {
      const code = transpileBash(`
        command
        if [ $? -ne 0 ]; then
          echo "Command failed"
          exit 1
        fi
      `);
      assertStringIncludes(code, "command");
    });

    it("should handle PIPESTATUS", () => {
      const code = transpileBash(`
        cmd1 | cmd2 | cmd3
        if [ \${PIPESTATUS[0]} -ne 0 ]; then
          echo "First command failed"
        fi
      `);
      assertStringIncludes(code, ".pipe(");
      assertStringIncludes(code, "PIPESTATUS");
    });
  });
});

// =============================================================================
// Integration Tests - Real-world Complete Scripts
// =============================================================================

describe("Integration Tests - Complete Scripts", () => {
  it("should handle complete deployment script", () => {
    const code = transpileBash(`
      #!/bin/bash
      set -euo pipefail

      ENVIRONMENT=$1
      APP_NAME="myapp"

      log() {
        echo "[$(date +'%Y-%m-%d %H:%M:%S')] $*"
      }

      log "Starting deployment to $ENVIRONMENT"

      # Build
      log "Building application"
      npm run build

      # Test
      log "Running tests"
      npm test

      # Deploy
      log "Deploying to $ENVIRONMENT"
      if [ "$ENVIRONMENT" = "production" ]; then
        aws s3 sync ./dist s3://prod-bucket
      else
        aws s3 sync ./dist s3://staging-bucket
      fi

      log "Deployment completed successfully"
    `);
    assertStringIncludes(code, "set");
    assertStringIncludes(code, "function log");
    assertStringIncludes(code, "npm run build");
    assertStringIncludes(code, "npm test");
    assertStringIncludes(code, "aws s3 sync");
  });

  it("should handle complete backup script", () => {
    const code = transpileBash(`
      #!/bin/bash
      set -e

      BACKUP_DIR=/backup
      DATE=$(date +%Y%m%d_%H%M%S)

      # Database backup
      pg_dump mydb > $BACKUP_DIR/db_$DATE.sql

      # Compress
      gzip $BACKUP_DIR/db_$DATE.sql

      # Upload to S3
      aws s3 cp $BACKUP_DIR/db_$DATE.sql.gz s3://backup-bucket/

      # Cleanup old backups (keep 7 days)
      find $BACKUP_DIR -name "db_*.sql.gz" -mtime +7 -delete
    `);
    assertStringIncludes(code, "DATE");
    assertStringIncludes(code, "pg_dump");
    assertStringIncludes(code, "gzip");
    assertStringIncludes(code, "aws s3");
    assertStringIncludes(code, "find");
  });

  it("should handle complete monitoring script", () => {
    const code = transpileBash(`
      #!/bin/bash

      SERVICE_NAME="myapp"
      MAX_RETRIES=3

      check_service() {
        if systemctl is-active --quiet $SERVICE_NAME; then
          return 0
        else
          return 1
        fi
      }

      for i in $(seq 1 $MAX_RETRIES); do
        if check_service; then
          echo "Service is running"
          exit 0
        fi

        echo "Attempt $i: Service not running, trying to restart"
        systemctl restart $SERVICE_NAME
        sleep 5
      done

      echo "Service failed to start after $MAX_RETRIES attempts"
      exit 1
    `);
    assertStringIncludes(code, "SERVICE_NAME");
    assertStringIncludes(code, "function check_service");
    assertStringIncludes(code, "systemctl");
  });
});
