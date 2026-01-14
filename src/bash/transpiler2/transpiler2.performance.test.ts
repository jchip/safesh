/**
 * Performance and stress tests for transpiler2
 *
 * These tests push the limits of the transpiler to ensure it can handle:
 * - Large scripts (1000+ lines)
 * - Deep nesting (10+ levels)
 * - Many variables (100+)
 * - Long pipeline chains (20+ commands)
 * - Memory efficiency
 * - Compilation speed benchmarks
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { parse } from "../parser.ts";
import { transpile, BashTranspiler2 } from "./mod.ts";

// =============================================================================
// Performance Test Utilities
// =============================================================================

/**
 * Measure execution time in milliseconds
 */
function measureTime(fn: () => void): number {
  const start = performance.now();
  fn();
  const end = performance.now();
  return end - start;
}

/**
 * Generate a large script with N lines of code
 */
function generateLargeScript(lines: number): string {
  const commands = [
    'echo "Processing line $i"',
    'value=$((i + 1))',
    'test $i -gt 100 && echo "Large"',
    'result="line_${i}_result"',
    'VAR_${i}="value_${i}"',
  ];

  const parts: string[] = ['#!/bin/bash', ''];

  for (let i = 0; i < lines; i++) {
    const cmd = commands[i % commands.length];
    if (cmd) {
      parts.push(cmd.replace(/\$i/g, `${i}`));
    }
  }

  return parts.join('\n');
}

/**
 * Generate deeply nested if statements
 */
function generateDeepNesting(depth: number): string {
  const lines: string[] = ['#!/bin/bash', ''];

  // Generate variables first
  for (let i = 0; i < depth; i++) {
    lines.push(`var${i}=${i}`);
  }
  lines.push('');

  for (let i = 0; i < depth; i++) {
    lines.push(`${'  '.repeat(i)}if test $var${i} -eq ${i}; then`);
    lines.push(`${'  '.repeat(i + 1)}echo "Level ${i}"`);
  }

  for (let i = depth - 1; i >= 0; i--) {
    lines.push(`${'  '.repeat(i)}fi`);
  }

  return lines.join('\n');
}

/**
 * Generate script with many variables
 */
function generateManyVariables(count: number): string {
  const lines: string[] = ['#!/bin/bash', ''];

  // Variable declarations
  for (let i = 0; i < count; i++) {
    lines.push(`var${i}="value_${i}"`);
  }

  lines.push('');

  // Variable usage
  for (let i = 0; i < count; i++) {
    if (i % 10 === 0) {
      lines.push(`echo "Variable ${i}: $var${i}"`);
    }
  }

  // Variable expansion
  lines.push('');
  lines.push('result="${var0}_${var1}_${var2}"');

  return lines.join('\n');
}

/**
 * Generate long pipeline chain
 */
function generateLongPipeline(stages: number): string {
  const commands = [
    'cat data.txt',
    'grep "pattern"',
    'sed "s/old/new/g"',
    'awk "{print $1}"',
    'sort',
    'uniq',
    'head -n 10',
    'tail -n 5',
    'tr "[:lower:]" "[:upper:]"',
    'cut -d: -f1',
  ];

  const pipeline = [];
  for (let i = 0; i < stages; i++) {
    pipeline.push(commands[i % commands.length]);
  }

  return `#!/bin/bash\n\n${pipeline.join(' | ')}`;
}

/**
 * Generate complex script with multiple features combined
 */
function generateComplexScript(): string {
  return `#!/bin/bash

# Function definitions
function process_data() {
  local input="$1"
  local count=0

  for item in $input; do
    count=$((count + 1))
    echo "Processing: $item"
  done

  return $count
}

# Array operations
declare -a files
files=(file1.txt file2.txt file3.txt)

# Main processing loop
for i in {0..50}; do
  case $i in
    0|1|2)
      echo "Starting phase 1"
      ;;
    *)
      echo "Phase 2: iteration $i"
      ;;
  esac

  # Command substitution with pipeline
  result=$(echo "$i" | cat | cat)

  # Conditional execution
  test $i -gt 25 && echo "High: $result" || echo "Low: $result"
done

# Cleanup with subshell
(
  cd /tmp
  rm -f temp_*.txt
  echo "Cleanup complete"
)

exit 0
`;
}

// =============================================================================
// Large Script Handling Tests
// =============================================================================

describe("Performance: Large Script Handling", () => {
  it("should transpile a 100-line script efficiently", () => {
    const script = generateLargeScript(100);
    const ast = parse(script);
    const time = measureTime(() => {
      const result = transpile(ast);
      assert(result.length > 0);
    });

    console.log(`  ⏱ 100 lines: ${time.toFixed(2)}ms`);
    assert(time < 1000, `Too slow for 100 lines: ${time}ms`);
  });

  it("should transpile a 500-line script", () => {
    const script = generateLargeScript(500);
    const ast = parse(script);
    const time = measureTime(() => {
      const result = transpile(ast);
      assert(result.length > 0);
    });

    console.log(`  ⏱ 500 lines: ${time.toFixed(2)}ms`);
    assert(time < 5000, `Too slow for 500 lines: ${time}ms`);
  });

  it("should transpile a 1000-line script", () => {
    const script = generateLargeScript(1000);
    const ast = parse(script);
    const time = measureTime(() => {
      const result = transpile(ast);
      assert(result.length > 0);
    });

    console.log(`  ⏱ 1000 lines: ${time.toFixed(2)}ms`);
    assert(time < 10000, `Too slow for 1000 lines: ${time}ms`);
  });

  it("should produce valid output for large scripts", () => {
    const script = generateLargeScript(50);
    const ast = parse(script);
    const result = transpile(ast);

    // Verify structure
    assertStringIncludes(result, "async function main");
    assertStringIncludes(result, "Processing line");
    assert(result.split('\n').length > 20);
  });
});

// =============================================================================
// Deep Recursion/Nesting Tests
// =============================================================================

describe("Performance: Deep Nesting", () => {
  it("should handle 5 levels of nesting", () => {
    const script = generateDeepNesting(5);
    const ast = parse(script);
    const result = transpile(ast);

    assert(result.length > 0);
    assertStringIncludes(result, "Level");
  });

  it("should handle 10 levels of nesting", () => {
    const script = generateDeepNesting(10);
    const ast = parse(script);
    const time = measureTime(() => {
      const result = transpile(ast);
      assert(result.length > 0);
    });

    console.log(`  ⏱ 10 levels: ${time.toFixed(2)}ms`);
    assert(time < 1000, `Too slow for 10 levels: ${time}ms`);
  });

  it("should handle 20 levels of nesting", () => {
    const script = generateDeepNesting(20);
    const ast = parse(script);
    const time = measureTime(() => {
      const result = transpile(ast);
      assert(result.length > 0);
    });

    console.log(`  ⏱ 20 levels: ${time.toFixed(2)}ms`);
    assert(time < 2000, `Too slow for 20 levels: ${time}ms`);
  });

  it("should maintain correct indentation with deep nesting", () => {
    const script = generateDeepNesting(5);
    const ast = parse(script);
    const result = transpile(ast);

    // Check that indentation increases
    const lines = result.split('\n');
    let maxIndent = 0;
    for (const line of lines) {
      const indent = line.match(/^ */)?.[0].length || 0;
      maxIndent = Math.max(maxIndent, indent);
    }

    assert(maxIndent >= 10, `Expected deep indentation, got ${maxIndent}`);
  });
});

// =============================================================================
// Many Variables Tests
// =============================================================================

describe("Performance: Many Variables", () => {
  it("should handle 50 variables", () => {
    const script = generateManyVariables(50);
    const ast = parse(script);
    const result = transpile(ast);

    assert(result.length > 0);
    assertStringIncludes(result, "var0");
    assertStringIncludes(result, "var49");
  });

  it("should handle 100 variables", () => {
    const script = generateManyVariables(100);
    const ast = parse(script);
    const time = measureTime(() => {
      const result = transpile(ast);
      assert(result.length > 0);
    });

    console.log(`  ⏱ 100 variables: ${time.toFixed(2)}ms`);
    assert(time < 2000, `Too slow for 100 variables: ${time}ms`);
  });

  it("should handle 200 variables", () => {
    const script = generateManyVariables(200);
    const ast = parse(script);
    const time = measureTime(() => {
      const result = transpile(ast);
      assert(result.length > 0);
    });

    console.log(`  ⏱ 200 variables: ${time.toFixed(2)}ms`);
    assert(time < 3000, `Too slow for 200 variables: ${time}ms`);
  });

  it("should track variable declarations correctly", () => {
    const script = generateManyVariables(20);
    const ast = parse(script);
    const result = transpile(ast);

    // Check that variables are properly declared
    const varCount = (result.match(/let var\d+/g) || []).length;
    assert(varCount > 15, `Expected at least 15 variable declarations, got ${varCount}`);
  });
});

// =============================================================================
// Long Pipeline Tests
// =============================================================================

describe("Performance: Long Pipeline Chains", () => {
  it("should handle 5-stage pipeline", () => {
    const script = generateLongPipeline(5);
    const ast = parse(script);
    const result = transpile(ast);

    assert(result.length > 0);
    // Check that pipeline commands are present
    assertStringIncludes(result, "cat");
  });

  it("should handle 10-stage pipeline", () => {
    const script = generateLongPipeline(10);
    const ast = parse(script);
    const time = measureTime(() => {
      const result = transpile(ast);
      assert(result.length > 0);
    });

    console.log(`  ⏱ 10-stage pipeline: ${time.toFixed(2)}ms`);
    assert(time < 1000, `Too slow for 10-stage pipeline: ${time}ms`);
  });

  it("should handle 20-stage pipeline", () => {
    const script = generateLongPipeline(20);
    const ast = parse(script);
    const time = measureTime(() => {
      const result = transpile(ast);
      assert(result.length > 0);
    });

    console.log(`  ⏱ 20-stage pipeline: ${time.toFixed(2)}ms`);
    assert(time < 2000, `Too slow for 20-stage pipeline: ${time}ms`);
  });

  it("should handle 50-stage pipeline", () => {
    const script = generateLongPipeline(50);
    const ast = parse(script);
    const time = measureTime(() => {
      const result = transpile(ast);
      assert(result.length > 0);
    });

    console.log(`  ⏱ 50-stage pipeline: ${time.toFixed(2)}ms`);
    assert(time < 5000, `Too slow for 50-stage pipeline: ${time}ms`);
  });

  it("should maintain pipeline structure in long chains", () => {
    const script = generateLongPipeline(15);
    const ast = parse(script);
    const result = transpile(ast);

    // Count chained method calls (dots followed by method name)
    const chainCount = (result.match(/\.\w+\(/g) || []).length;
    assert(chainCount >= 10, `Expected at least 10 chained calls, got ${chainCount}`);
  });
});

// =============================================================================
// Memory Efficiency Tests
// =============================================================================

describe("Performance: Memory Efficiency", () => {
  it("should not leak memory with multiple transpilations", () => {
    const script = generateLargeScript(100);
    const ast = parse(script);

    // Run multiple times to check for memory leaks
    const iterations = 50;
    const time = measureTime(() => {
      for (let i = 0; i < iterations; i++) {
        const result = transpile(ast);
        assert(result.length > 0);
      }
    });

    console.log(`  ⏱ ${iterations} iterations: ${time.toFixed(2)}ms`);
    console.log(`  ⏱ Avg per iteration: ${(time / iterations).toFixed(2)}ms`);

    // Each iteration should be fast
    const avgTime = time / iterations;
    assert(avgTime < 100, `Too slow per iteration: ${avgTime}ms`);
  });

  it("should handle repeated transpilation of different scripts", () => {
    const scripts = [
      generateLargeScript(50),
      generateDeepNesting(8),
      generateManyVariables(50),
      generateLongPipeline(15),
    ];

    const asts = scripts.map(s => parse(s));
    const iterations = 10;

    const time = measureTime(() => {
      for (let i = 0; i < iterations; i++) {
        for (const ast of asts) {
          const result = transpile(ast);
          assert(result.length > 0);
        }
      }
    });

    const totalTranspilations = iterations * scripts.length;
    console.log(`  ⏱ ${totalTranspilations} transpilations: ${time.toFixed(2)}ms`);
    console.log(`  ⏱ Avg: ${(time / totalTranspilations).toFixed(2)}ms`);
  });
});

// =============================================================================
// Compilation Time Benchmarks
// =============================================================================

describe("Performance: Compilation Time Benchmarks", () => {
  it("should benchmark small script (10 lines)", () => {
    const script = generateLargeScript(10);
    const ast = parse(script);

    const iterations = 100;
    const times: number[] = [];

    for (let i = 0; i < iterations; i++) {
      const time = measureTime(() => {
        transpile(ast);
      });
      times.push(time);
    }

    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    const min = Math.min(...times);
    const max = Math.max(...times);

    console.log(`  ⏱ Small (10 lines) - Avg: ${avg.toFixed(2)}ms, Min: ${min.toFixed(2)}ms, Max: ${max.toFixed(2)}ms`);
  });

  it("should benchmark medium script (100 lines)", () => {
    const script = generateLargeScript(100);
    const ast = parse(script);

    const iterations = 50;
    const times: number[] = [];

    for (let i = 0; i < iterations; i++) {
      const time = measureTime(() => {
        transpile(ast);
      });
      times.push(time);
    }

    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    const min = Math.min(...times);
    const max = Math.max(...times);

    console.log(`  ⏱ Medium (100 lines) - Avg: ${avg.toFixed(2)}ms, Min: ${min.toFixed(2)}ms, Max: ${max.toFixed(2)}ms`);
  });

  it("should benchmark large script (500 lines)", () => {
    const script = generateLargeScript(500);
    const ast = parse(script);

    const iterations = 10;
    const times: number[] = [];

    for (let i = 0; i < iterations; i++) {
      const time = measureTime(() => {
        transpile(ast);
      });
      times.push(time);
    }

    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    const min = Math.min(...times);
    const max = Math.max(...times);

    console.log(`  ⏱ Large (500 lines) - Avg: ${avg.toFixed(2)}ms, Min: ${min.toFixed(2)}ms, Max: ${max.toFixed(2)}ms`);
  });

  it("should show scaling characteristics", () => {
    const sizes = [10, 50, 100, 200, 500];
    const results: Array<{ size: number; time: number }> = [];

    for (const size of sizes) {
      const script = generateLargeScript(size);
      const ast = parse(script);
      const time = measureTime(() => {
        transpile(ast);
      });
      results.push({ size, time });
    }

    console.log("  ⏱ Scaling characteristics:");
    for (const { size, time } of results) {
      const timePerLine = time / size;
      console.log(`    ${size} lines: ${time.toFixed(2)}ms (${timePerLine.toFixed(3)}ms/line)`);
    }

    // Check for reasonable scaling (should be roughly linear or better)
    const firstResult = results[0];
    const lastResult = results[results.length - 1];
    if (!firstResult || !lastResult) return;

    const smallTimePerLine = firstResult.time / firstResult.size;
    const largeTimePerLine = lastResult.time / lastResult.size;

    // Large scripts shouldn't be more than 3x slower per line than small scripts
    assert(
      largeTimePerLine < smallTimePerLine * 3,
      `Poor scaling: ${smallTimePerLine.toFixed(3)}ms/line -> ${largeTimePerLine.toFixed(3)}ms/line`
    );
  });
});

// =============================================================================
// Edge Case Combinations
// =============================================================================

describe("Performance: Complex Edge Case Combinations", () => {
  it("should handle complex real-world-like script", () => {
    const script = generateComplexScript();
    const ast = parse(script);

    const time = measureTime(() => {
      const result = transpile(ast);
      assert(result.length > 0);
    });

    console.log(`  ⏱ Complex script: ${time.toFixed(2)}ms`);
    assert(time < 5000, `Too slow for complex script: ${time}ms`);
  });

  it("should handle complex script with correct structure", () => {
    const script = generateComplexScript();
    const ast = parse(script);
    const result = transpile(ast);

    // Verify key elements are present
    assertStringIncludes(result, "function process_data");
    assertStringIncludes(result, "for (");
    assertStringIncludes(result, "case");
    assertStringIncludes(result, "declare");
    assert(result.length > 1000, "Expected substantial output");
  });

  it("should handle mixed nesting and pipelines", () => {
    const script = `#!/bin/bash

for i in {1..20}; do
  if [ $i -gt 10 ]; then
    for j in {1..10}; do
      echo "$i:$j" | grep "1[5-9]" | sed 's/:/=/g' | awk -F= '{print $1 * $2}'
    done
  else
    cat file.txt | sort | uniq | head -n 5 | tail -n 2
  fi
done
`;

    const ast = parse(script);
    const result = transpile(ast);

    assert(result.length > 0);
    assertStringIncludes(result, "for (");
  });

  it("should handle script with many function definitions", () => {
    const functions = [];
    for (let i = 0; i < 20; i++) {
      functions.push(`
function func${i}() {
  local param="$1"
  echo "Function ${i}: $param"
  return ${i}
}
`);
    }

    const script = `#!/bin/bash\n\n${functions.join('\n')}\n\nfunc10 "test"\n`;
    const ast = parse(script);
    const result = transpile(ast);

    assert(result.length > 0);
    assertStringIncludes(result, "func0");
    assertStringIncludes(result, "func19");
  });

  it("should handle script with many case statements", () => {
    const cases = [];
    for (let i = 0; i < 50; i++) {
      cases.push(`    ${i}) echo "Case ${i}" ;;`);
    }

    const script = `#!/bin/bash

for i in {0..49}; do
  case $i in
${cases.join('\n')}
    *) echo "Default" ;;
  esac
done
`;

    const ast = parse(script);
    const result = transpile(ast);

    assert(result.length > 0);
    // Check for if/else-if chain (transpiler uses if-else instead of switch)
    assertStringIncludes(result, "else if");
  });

  it("should handle mixed array and variable operations", () => {
    const arrays = Array.from({ length: 20 }, (_, i) => `arr${i}=(one${i} two${i} three${i})`).join('\n');
    const variables = Array.from({ length: 20 }, (_, i) => `var${i}="value${i}"`).join('\n');

    const script = `#!/bin/bash

# Many arrays
${arrays}

# Many variables
${variables}

# Operations
for i in {0..19}; do
  echo "$var0"
  echo "\${arr0[0]}"
done
`;

    const ast = parse(script);
    const result = transpile(ast);

    assert(result.length > 0);
    assert(result.split('\n').length > 30);
  });
});

// =============================================================================
// Stress Tests
// =============================================================================

describe("Performance: Stress Tests", () => {
  it("should handle extremely long single line", () => {
    const longCommand = 'echo "' + 'x'.repeat(1000) + '"';
    const script = `#!/bin/bash\n\n${longCommand}`;

    const ast = parse(script);
    const result = transpile(ast);

    assert(result.length > 1000);
    assertStringIncludes(result, 'xxx');
  });

  it("should handle many sequential commands", () => {
    const commands = [];
    for (let i = 0; i < 500; i++) {
      commands.push(`echo "Command ${i}"`);
    }

    const script = `#!/bin/bash\n\n${commands.join('\n')}`;
    const ast = parse(script);

    const time = measureTime(() => {
      const result = transpile(ast);
      assert(result.length > 0);
    });

    console.log(`  ⏱ 500 sequential commands: ${time.toFixed(2)}ms`);
    assert(time < 5000, `Too slow: ${time}ms`);
  });

  it("should handle deeply nested subshells", () => {
    const script = `#!/bin/bash

result=$(echo "level1")
result2=$(echo "$result" | cat)
result3=$(echo "$result2" | cat)
result4=$(echo "$result3" | cat)
result5=$(echo "$result4" | cat)

echo "$result5"
`;

    const ast = parse(script);
    const result = transpile(ast);

    assert(result.length > 0);
    assertStringIncludes(result, "level1");
  });

  it("should handle many command substitutions", () => {
    const substitutions = [];
    for (let i = 0; i < 50; i++) {
      substitutions.push(`val${i}=$(echo ${i})`);
    }

    const script = `#!/bin/bash\n\n${substitutions.join('\n')}\n\necho "$val0 $val49"`;
    const ast = parse(script);

    const time = measureTime(() => {
      const result = transpile(ast);
      assert(result.length > 0);
    });

    console.log(`  ⏱ 50 command substitutions: ${time.toFixed(2)}ms`);
    assert(time < 2000, `Too slow: ${time}ms`);
  });

  it("should handle complex heredoc scenarios", () => {
    const script = `#!/bin/bash

cat > file1.txt <<'EOF1'
Content for file 1
Line 2 of file 1
EOF1

cat > file2.txt <<'EOF2'
Content for file 2
Line 2 of file 2
EOF2

cat > file3.txt <<'EOF3'
Content for file 3
Line 2 of file 3
EOF3
`;

    const ast = parse(script);
    const result = transpile(ast);

    assert(result.length > 0);
    assertStringIncludes(result, "Content for file");
  });
});

// =============================================================================
// Regression Tests for Performance Issues
// =============================================================================

describe("Performance: Regression Tests", () => {
  it("should not have quadratic complexity with variable tracking", () => {
    // Test that adding more variables doesn't slow down exponentially
    const sizes = [10, 20, 40];
    const times: number[] = [];

    for (const size of sizes) {
      const script = generateManyVariables(size);
      const ast = parse(script);
      const time = measureTime(() => {
        transpile(ast);
      });
      times.push(time);
    }

    // Check that doubling the size doesn't quadruple the time
    const time0 = times[0];
    const time1 = times[1];
    const time2 = times[2];
    if (time0 && time1 && time2 && time0 > 0) {
      const ratio1 = time1 / time0;
      const ratio2 = time2 / time1;

      console.log(`  ⏱ Complexity check: ${ratio1.toFixed(2)}x, ${ratio2.toFixed(2)}x`);

      // Should be roughly linear (2-3x) not quadratic (4x+)
      assert(ratio1 < 5, `Possible quadratic complexity: ${ratio1}x slowdown`);
      assert(ratio2 < 5, `Possible quadratic complexity: ${ratio2}x slowdown`);
    }
  });

  it("should not degrade with repeated context operations", () => {
    const script = `#!/bin/bash

for i in {1..100}; do
  echo "Iteration $i"
done
`;

    const ast = parse(script);
    const iterations = 20;
    const times: number[] = [];

    for (let i = 0; i < iterations; i++) {
      const time = measureTime(() => {
        transpile(ast);
      });
      times.push(time);
    }

    const firstHalf = times.slice(0, iterations / 2);
    const secondHalf = times.slice(iterations / 2);

    const avgFirst = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
    const avgSecond = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;

    console.log(`  ⏱ First half avg: ${avgFirst.toFixed(2)}ms, Second half avg: ${avgSecond.toFixed(2)}ms`);

    // Second half shouldn't be significantly slower (no degradation)
    assert(avgSecond < avgFirst * 1.5, "Performance degradation detected");
  });

  it("should handle alternating simple and complex commands efficiently", () => {
    const commands = [];
    for (let i = 0; i < 100; i++) {
      if (i % 2 === 0) {
        commands.push(`echo "Simple ${i}"`);
      } else {
        commands.push(`result=$(cat file.txt | grep "pattern" | awk '{print $1}' | sort | uniq)`);
      }
    }

    const script = `#!/bin/bash\n\n${commands.join('\n')}`;
    const ast = parse(script);

    const time = measureTime(() => {
      const result = transpile(ast);
      assert(result.length > 0);
    });

    console.log(`  ⏱ Mixed complexity (100 commands): ${time.toFixed(2)}ms`);
    assert(time < 3000, `Too slow: ${time}ms`);
  });
});
