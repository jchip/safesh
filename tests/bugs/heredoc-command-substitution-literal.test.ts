import { assertEquals, assertStringIncludes } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { parse } from "../../src/bash/parser.ts";
import { transpile } from "../../src/bash/transpiler2/mod.ts";
import { executeCode } from "../../src/runtime/executor.ts";
import type { SafeShellConfig } from "../../src/core/types.ts";

function transpileBash(bash: string): string {
  return transpile(parse(bash), { imports: false, strict: false });
}

const config: SafeShellConfig = {
  permissions: {
    read: [Deno.cwd(), "/tmp"],
    write: ["/tmp"],
    run: ["cat", "printf"],
  },
  timeout: 5000,
};

describe("Bug: heredoc content inside command substitution", () => {
  it("keeps parenthesized quoted heredoc content literal", async () => {
    const code = transpileBash(`printf "%s" "$(cat <<'EOF'
Keeps CSRF token).

**Dev tooling (\`scripts/dev/start-local-infra.js\`)**
- \`--providers.file.watch\` stays literal.
EOF
)"`);

    assertEquals(code.includes('$.cmd("scripts/dev/start-local-infra.js")'), false, code);
    assertEquals(code.includes('$.cmd("--providers.file.watch")'), false, code);

    const result = await executeCode(code, config, { cwd: Deno.cwd() });

    assertEquals(result.success, true, `stderr: ${result.stderr}\ncode:\n${code}`);
    assertStringIncludes(result.stdout, "Keeps CSRF token).");
    assertStringIncludes(result.stdout, "**Dev tooling (`scripts/dev/start-local-infra.js`)**");
    assertStringIncludes(result.stdout, "- `--providers.file.watch` stays literal.");
  });
});
