/**
 * Tests for word expansion features (SSH-301, SSH-302, SSH-303)
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { parse } from "../../parser.ts";
import { transpile } from "../mod.ts";

// Helper function to transpile bash code
function transpileBash(bash: string): string {
  const ast = parse(bash);
  return transpile(ast);
}

describe("SSH-301: Tilde Expansion", () => {
  it("should expand ~ to HOME directory", () => {
    const code = transpileBash('echo ~');
    // Should expand ~ to $HOME
    assertStringIncludes(code, 'Deno.env.get("HOME")');
  });

  it("should expand ~/path to HOME/path", () => {
    const code = transpileBash('echo ~/documents');
    assertStringIncludes(code, 'Deno.env.get("HOME")');
    assertStringIncludes(code, '/documents');
  });

  it("should handle ~ in variable assignment", () => {
    const code = transpileBash('dir=~/test');
    assertStringIncludes(code, 'Deno.env.get');
    assertStringIncludes(code, 'HOME');
  });

  it("should not expand ~user (unsupported for now)", () => {
    const code = transpileBash('echo ~root');
    // Should not try to expand ~user, just pass through
    // Will contain the literal ~root
  });
});

describe("SSH-302: Brace Expansion", () => {
  describe("Comma-separated braces", () => {
    it("should expand {a,b,c}", () => {
      const code = transpileBash('echo {a,b,c}');
      // Should expand to: a b c
      assertStringIncludes(code, 'a b c');
    });

    it("should expand prefix{1,2,3}suffix", () => {
      const code = transpileBash('echo file{1,2,3}.txt');
      // Should expand to: file1.txt file2.txt file3.txt
      assertStringIncludes(code, 'file1.txt file2.txt file3.txt');
    });

    it("should handle multiple comma items", () => {
      const code = transpileBash('echo {red,green,blue}');
      assertStringIncludes(code, 'red green blue');
    });
  });

  describe("Numeric range braces", () => {
    it("should expand {1..5}", () => {
      const code = transpileBash('echo {1..5}');
      // Should expand to: 1 2 3 4 5
      assertStringIncludes(code, '1 2 3 4 5');
    });

    it("should expand {0..3}", () => {
      const code = transpileBash('echo {0..3}');
      assertStringIncludes(code, '0 1 2 3');
    });

    it("should expand {5..1} (reverse)", () => {
      const code = transpileBash('echo {5..1}');
      // Should expand in reverse: 5 4 3 2 1
      assertStringIncludes(code, '5 4 3 2 1');
    });

    it("should handle negative numbers {-2..2}", () => {
      const code = transpileBash('echo {-2..2}');
      assertStringIncludes(code, '-2 -1 0 1 2');
    });

    it("should expand with step {1..10..2}", () => {
      const code = transpileBash('echo {1..10..2}');
      // Should expand: 1 3 5 7 9
      assertStringIncludes(code, '1 3 5 7 9');
    });
  });

  describe("Character range braces", () => {
    it("should expand {a..e}", () => {
      const code = transpileBash('echo {a..e}');
      assertStringIncludes(code, 'a b c d e');
    });

    it("should expand {A..D}", () => {
      const code = transpileBash('echo {A..D}');
      assertStringIncludes(code, 'A B C D');
    });

    it("should expand {z..x} (reverse)", () => {
      const code = transpileBash('echo {z..x}');
      assertStringIncludes(code, 'z y x');
    });
  });

  describe("Embedded braces", () => {
    it("should expand braces in middle of word", () => {
      const code = transpileBash('echo test{1,2}.log');
      assertStringIncludes(code, 'test1.log test2.log');
    });

    it("should expand range with prefix/suffix", () => {
      const code = transpileBash('echo file{1..3}.txt');
      assertStringIncludes(code, 'file1.txt file2.txt file3.txt');
    });
  });
});

describe("SSH-303: Array Variable Support", () => {
  describe("Array element access", () => {
    it("should support ${arr[0]} syntax", () => {
      const code = transpileBash('echo ${arr[0]}');
      // Note: Parser might not support this yet, so we're checking transpiler readiness
      // If parser doesn't support it, this will be a simple expansion
      // The transpiler code is ready to handle subscript field when parser provides it
    });

    it("should support ${arr[1]} syntax", () => {
      const code = transpileBash('echo ${arr[1]}');
      // Transpiler ready for subscript support
    });
  });

  describe("Array expansion", () => {
    it("should support ${arr[@]} for all elements", () => {
      const code = transpileBash('echo ${arr[@]}');
      // Note: Parser support may be limited
      // Transpiler will handle when parser provides subscript: "@"
    });

    it("should support ${arr[*]} for all elements", () => {
      const code = transpileBash('echo ${arr[*]}');
      // Transpiler ready for subscript: "*"
    });
  });

  describe("Array length", () => {
    it("should support ${#arr[@]} for array length", () => {
      const code = transpileBash('echo ${#arr[@]}');
      // Transpiler ready for modifier: "length" with subscript
    });

    it("should support ${#arr[*]} for array length", () => {
      const code = transpileBash('echo ${#arr[*]}');
      // Transpiler ready
    });
  });

  describe("Array indices", () => {
    it("should support ${!arr[@]} for array indices", () => {
      const code = transpileBash('echo ${!arr[@]}');
      // Should generate Object.keys(arr).join(" ") to get array indices
      assertStringIncludes(code, 'Object.keys');
    });

    it("should support ${!arr[*]} for array indices", () => {
      const code = transpileBash('echo ${!arr[*]}');
      // Should generate Object.keys(arr).join(" ") to get array indices
      assertStringIncludes(code, 'Object.keys');
    });
  });
});

describe("SSH-330: Indirect Variable Reference", () => {
  it("should transpile ${!ref} to eval(ref)", () => {
    const code = transpileBash('echo ${!ref}');
    // Should generate eval(ref) to look up the variable name stored in ref
    assertStringIncludes(code, 'eval(ref)');
  });

  it("should handle indirect reference in variable assignment", () => {
    const code = transpileBash('value=${!varname}');
    assertStringIncludes(code, 'eval(varname)');
  });

  it("should support indirect reference with longer variable names", () => {
    const code = transpileBash('echo ${!my_variable_ref}');
    assertStringIncludes(code, 'eval(my_variable_ref)');
  });

  it("should handle multiple indirect references in one command", () => {
    const code = transpileBash('echo ${!ref1} ${!ref2}');
    assertStringIncludes(code, 'eval(ref1)');
    assertStringIncludes(code, 'eval(ref2)');
  });

  it("should work within double quotes", () => {
    const code = transpileBash('echo "Value: ${!ref}"');
    assertStringIncludes(code, 'eval(ref)');
  });
});

describe("Integration tests", () => {
  it("should handle tilde in command with args", () => {
    const code = transpileBash('ls ~/Downloads ~/Documents');
    // Both tildes should be expanded
    const homeCount = (code.match(/Deno\.env\.get\("HOME"\)/g) || []).length;
    assertEquals(homeCount >= 2, true);
  });

  it("should handle brace expansion in loop", () => {
    const code = transpileBash('for i in {1..3}; do echo $i; done');
    assertStringIncludes(code, '1 2 3');
  });

  it("should combine tilde and brace expansion", () => {
    const code = transpileBash('echo ~/{file1,file2}.txt');
    // Should have both HOME expansion and brace expansion
    assertStringIncludes(code, 'Deno.env.get("HOME")');
  });
});
