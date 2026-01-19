/**
 * SSH-407: cat command with heredoc fails
 *
 * Tests to ensure heredoc with cat command transpiles and executes correctly.
 * These tests serve as regression tests for the bug.
 */

import { describe, it } from "@std/testing/bdd";
import { parse, transpile } from "../mod.ts";
import { assertStringIncludes, assertEquals } from "@std/assert";
import { executeCode } from "../../runtime/executor.ts";
import { loadConfig } from "../../core/config.ts";

describe("SSH-407: cat with heredoc", () => {
  describe("Transpilation", () => {
    it("should transpile cat with heredoc and output redirection", () => {
      const input = `cat > /tmp/file.md << 'EOF'
content
EOF`;
      const ast = parse(input);
      const output = transpile(ast, { imports: false, strict: false });

      // Should use $.cmd style (not fluent $.cat)
      assertStringIncludes(output, '$.cmd("cat")');
      // Should have output redirection
      assertStringIncludes(output, '.stdout("/tmp/file.md")');
      // Should have stdin with heredoc content
      assertStringIncludes(output, '.stdin(');
      assertStringIncludes(output, 'content');
    });

    it("should transpile cat with heredoc only (no output redirect)", () => {
      const input = `cat <<'EOF'
hello world
EOF`;
      const ast = parse(input);
      const output = transpile(ast, { imports: false, strict: false });

      // Should use $.cmd style due to heredoc
      assertStringIncludes(output, '$.cmd("cat")');
      assertStringIncludes(output, '.stdin(');
      assertStringIncludes(output, 'hello world');
    });

    it("should transpile cat with heredoc in append mode", () => {
      const input = `cat >> /tmp/file.md << 'EOF'
more content
EOF`;
      const ast = parse(input);
      const output = transpile(ast, { imports: false, strict: false });

      assertStringIncludes(output, '$.cmd("cat")');
      assertStringIncludes(output, '.stdout("/tmp/file.md", { append: true })');
      assertStringIncludes(output, '.stdin(');
      assertStringIncludes(output, 'more content');
    });

    it("should transpile cat with heredoc and tab stripping (<<-)", () => {
      const input = `cat <<-'EOF'
\t\tindented content
EOF`;
      const ast = parse(input);
      const output = transpile(ast, { imports: false, strict: false });

      assertStringIncludes(output, '$.cmd("cat")');
      assertStringIncludes(output, '.stdin(');
      // Tab stripping option should be present
      assertStringIncludes(output, 'stripTabs: true');
    });

    it("should handle multiline heredoc content", () => {
      const input = `cat > /tmp/multiline.md << 'EOF'
Line 1
Line 2
Line 3
EOF`;
      const ast = parse(input);
      const output = transpile(ast, { imports: false, strict: false });

      assertStringIncludes(output, '$.cmd("cat")');
      assertStringIncludes(output, 'Line 1');
      assertStringIncludes(output, 'Line 2');
      assertStringIncludes(output, 'Line 3');
    });
  });

  describe("Runtime Execution", () => {
    it("should execute cat with heredoc and create output file", async () => {
      const testFile = `/tmp/ssh-407-test-${Date.now()}.md`;
      const code = `await $.cmd("cat").stdout("${testFile}").stdin("test content\\nline 2\\n").exec();`;

      const config = await loadConfig(Deno.cwd());
      const result = await executeCode(code, config, { cwd: Deno.cwd() });

      assertEquals(result.code, 0, "Command should succeed");

      // Verify file was created with correct content
      const content = await Deno.readTextFile(testFile);
      assertEquals(content, "test content\nline 2\n");

      // Cleanup
      await Deno.remove(testFile);
    });

    it("should execute cat with heredoc to stdout", async () => {
      const code = `const result = await $.cmd("cat").stdin("hello from heredoc\\n").exec(); console.log(result.stdout);`;

      const config = await loadConfig(Deno.cwd());
      const result = await executeCode(code, config, { cwd: Deno.cwd() });

      assertEquals(result.code, 0, "Command should succeed");
      assertStringIncludes(result.stdout ?? "", "hello from heredoc");
    });

    it("should execute cat with heredoc in append mode", async () => {
      const testFile = `/tmp/ssh-407-append-${Date.now()}.md`;

      // Create initial file
      await Deno.writeTextFile(testFile, "initial content\n");

      const code = `await $.cmd("cat").stdout("${testFile}", { append: true }).stdin("appended content\\n").exec();`;

      const config = await loadConfig(Deno.cwd());
      const result = await executeCode(code, config, { cwd: Deno.cwd() });

      assertEquals(result.code, 0, "Command should succeed");

      // Verify content was appended
      const content = await Deno.readTextFile(testFile);
      assertEquals(content, "initial content\nappended content\n");

      // Cleanup
      await Deno.remove(testFile);
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty heredoc content", () => {
      const input = `cat > /tmp/empty.md << 'EOF'
EOF`;
      const ast = parse(input);
      const output = transpile(ast, { imports: false, strict: false });

      assertStringIncludes(output, '$.cmd("cat")');
      assertStringIncludes(output, '.stdin(');
    });

    it("should handle heredoc with special characters", () => {
      const input = `cat << 'EOF'
Special chars: $VAR \`command\` "quotes" 'single'
EOF`;
      const ast = parse(input);
      const output = transpile(ast, { imports: false, strict: false });

      assertStringIncludes(output, '$.cmd("cat")');
      assertStringIncludes(output, '.stdin(');
      // Special characters should be preserved
      assertStringIncludes(output, 'Special chars');
    });

    it("should not use fluent API when heredoc is present", () => {
      const input = `cat << 'EOF'
content
EOF`;
      const ast = parse(input);
      const output = transpile(ast, { imports: false, strict: false });

      // Should NOT generate $.cat() fluent style
      assertEquals(output.includes('$.cat('), false, "Should not use fluent $.cat() with heredoc");
      // Should use $.cmd() style
      assertStringIncludes(output, '$.cmd("cat")');
    });
  });
});
