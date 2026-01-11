/**
 * jq Command Tests
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { jqExec } from "./jq.ts";

describe("jq", () => {
  describe("basic queries", () => {
    it("returns identity with .", async () => {
      const result = await jqExec(".", '{"name":"John","age":30}');
      assertEquals(result.exitCode, 0);
      const parsed = JSON.parse(result.output);
      assertEquals(parsed, { name: "John", age: 30 });
    });

    it("accesses simple field", async () => {
      const result = await jqExec(".name", '{"name":"John","age":30}');
      assertEquals(result.exitCode, 0);
      assertEquals(JSON.parse(result.output), "John");
    });

    it("accesses nested field", async () => {
      const result = await jqExec(
        ".user.name",
        '{"user":{"name":"Alice","id":1}}',
      );
      assertEquals(result.exitCode, 0);
      assertEquals(JSON.parse(result.output), "Alice");
    });

    it("returns null for missing field", async () => {
      const result = await jqExec(".missing", '{"name":"John"}');
      assertEquals(result.exitCode, 0);
      assertEquals(JSON.parse(result.output), null);
    });
  });

  describe("array operations", () => {
    it("accesses array index", async () => {
      const result = await jqExec(".[0]", '["a","b","c"]');
      assertEquals(result.exitCode, 0);
      assertEquals(JSON.parse(result.output), "a");
    });

    it("supports negative array index", async () => {
      const result = await jqExec(".[-1]", '["a","b","c"]');
      assertEquals(result.exitCode, 0);
      assertEquals(JSON.parse(result.output), "c");
    });

    it("iterates array with .[]", async () => {
      const result = await jqExec(".[]", '["a","b","c"]');
      assertEquals(result.exitCode, 0);
      const lines = result.output.split("\n");
      assertEquals(lines.length, 3);
      assertEquals(JSON.parse(lines[0]!), "a");
      assertEquals(JSON.parse(lines[1]!), "b");
      assertEquals(JSON.parse(lines[2]!), "c");
    });

    it("iterates nested array", async () => {
      const result = await jqExec(".items[]", '{"items":["x","y"]}');
      assertEquals(result.exitCode, 0);
      const lines = result.output.split("\n");
      assertEquals(lines.length, 2);
      assertEquals(JSON.parse(lines[0]!), "x");
      assertEquals(JSON.parse(lines[1]!), "y");
    });

    it("slices array", async () => {
      const result = await jqExec(".[1:3]", '["a","b","c","d"]');
      assertEquals(result.exitCode, 0);
      assertEquals(JSON.parse(result.output), ["b", "c"]);
    });
  });

  describe("type and introspection", () => {
    it("returns type of value", async () => {
      const tests = [
        ['{"a":1}', "object"],
        ['["a"]', "array"],
        ['"hello"', "string"],
        ["123", "number"],
        ["true", "boolean"],
        ["null", "null"],
      ];

      for (const [input, expected] of tests) {
        const result = await jqExec("type", input!);
        assertEquals(result.exitCode, 0);
        assertEquals(JSON.parse(result.output), expected);
      }
    });

    it("returns length of string", async () => {
      const result = await jqExec("length", '"hello"');
      assertEquals(result.exitCode, 0);
      assertEquals(JSON.parse(result.output), 5);
    });

    it("returns length of array", async () => {
      const result = await jqExec("length", '[1,2,3,4]');
      assertEquals(result.exitCode, 0);
      assertEquals(JSON.parse(result.output), 4);
    });

    it("returns length of object", async () => {
      const result = await jqExec("length", '{"a":1,"b":2,"c":3}');
      assertEquals(result.exitCode, 0);
      assertEquals(JSON.parse(result.output), 3);
    });

    it("returns object keys sorted", async () => {
      const result = await jqExec("keys", '{"c":3,"a":1,"b":2}');
      assertEquals(result.exitCode, 0);
      assertEquals(JSON.parse(result.output), ["a", "b", "c"]);
    });

    it("returns object keys unsorted", async () => {
      const result = await jqExec("keys_unsorted", '{"c":3,"a":1,"b":2}');
      assertEquals(result.exitCode, 0);
      // Keys should be in insertion order (in modern JS)
      const keys = JSON.parse(result.output);
      assertEquals(keys.length, 3);
      assertEquals(keys.includes("a"), true);
      assertEquals(keys.includes("b"), true);
      assertEquals(keys.includes("c"), true);
    });

    it("returns object values", async () => {
      const result = await jqExec("values", '{"a":1,"b":2}');
      assertEquals(result.exitCode, 0);
      const values = JSON.parse(result.output);
      assertEquals(values.sort(), [1, 2]);
    });
  });

  describe("filtering with select", () => {
    it("filters with field existence", async () => {
      const result = await jqExec("select(.active)", '{"active":true}');
      assertEquals(result.exitCode, 0);
      assertEquals(JSON.parse(result.output), { active: true });
    });

    it("returns empty for failed select", async () => {
      const result = await jqExec("select(.active)", '{"active":false}');
      assertEquals(result.exitCode, 0);
      assertEquals(result.output, "");
    });

    it("filters with comparison", async () => {
      const result = await jqExec("select(.age > 18)", '{"age":25}');
      assertEquals(result.exitCode, 0);
      assertEquals(JSON.parse(result.output), { age: 25 });
    });

    it("filters with equality", async () => {
      const result = await jqExec('select(.name == "John")', '{"name":"John"}');
      assertEquals(result.exitCode, 0);
      assertEquals(JSON.parse(result.output), { name: "John" });
    });
  });

  describe("transformation with map", () => {
    it("maps over array elements", async () => {
      const result = await jqExec("map(.name)", '[{"name":"Alice"},{"name":"Bob"}]');
      assertEquals(result.exitCode, 0);
      assertEquals(JSON.parse(result.output), ["Alice", "Bob"]);
    });

    it("maps with nested access", async () => {
      const result = await jqExec(
        "map(.user.id)",
        '[{"user":{"id":1}},{"user":{"id":2}}]',
      );
      assertEquals(result.exitCode, 0);
      assertEquals(JSON.parse(result.output), [1, 2]);
    });
  });

  describe("array functions", () => {
    it("sorts array", async () => {
      const result = await jqExec("sort", '[3,1,4,1,5,9,2,6]');
      assertEquals(result.exitCode, 0);
      assertEquals(JSON.parse(result.output), [1, 1, 2, 3, 4, 5, 6, 9]);
    });

    it("sorts strings", async () => {
      const result = await jqExec("sort", '["charlie","alice","bob"]');
      assertEquals(result.exitCode, 0);
      assertEquals(JSON.parse(result.output), ["alice", "bob", "charlie"]);
    });

    it("reverses array", async () => {
      const result = await jqExec("reverse", '[1,2,3]');
      assertEquals(result.exitCode, 0);
      assertEquals(JSON.parse(result.output), [3, 2, 1]);
    });

    it("gets unique elements", async () => {
      const result = await jqExec("unique", '[1,2,1,3,2,4]');
      assertEquals(result.exitCode, 0);
      const values = JSON.parse(result.output);
      assertEquals(values.length, 4);
      assertEquals(values.includes(1), true);
      assertEquals(values.includes(2), true);
      assertEquals(values.includes(3), true);
      assertEquals(values.includes(4), true);
    });

    it("flattens array", async () => {
      const result = await jqExec("flatten", '[[1,2],[3,4]]');
      assertEquals(result.exitCode, 0);
      assertEquals(JSON.parse(result.output), [1, 2, 3, 4]);
    });

    it("gets min value", async () => {
      const result = await jqExec("min", '[5,2,8,1,9]');
      assertEquals(result.exitCode, 0);
      assertEquals(JSON.parse(result.output), 1);
    });

    it("gets max value", async () => {
      const result = await jqExec("max", '[5,2,8,1,9]');
      assertEquals(result.exitCode, 0);
      assertEquals(JSON.parse(result.output), 9);
    });

    it("adds numbers", async () => {
      const result = await jqExec("add", '[1,2,3,4]');
      assertEquals(result.exitCode, 0);
      assertEquals(JSON.parse(result.output), 10);
    });

    it("concatenates strings", async () => {
      const result = await jqExec("add", '["hello"," ","world"]');
      assertEquals(result.exitCode, 0);
      assertEquals(JSON.parse(result.output), "hello world");
    });

    it("concatenates arrays", async () => {
      const result = await jqExec("add", '[[1,2],[3,4]]');
      assertEquals(result.exitCode, 0);
      assertEquals(JSON.parse(result.output), [1, 2, 3, 4]);
    });

    it("gets first element", async () => {
      const result = await jqExec("first", '[1,2,3]');
      assertEquals(result.exitCode, 0);
      assertEquals(JSON.parse(result.output), 1);
    });

    it("gets last element", async () => {
      const result = await jqExec("last", '[1,2,3]');
      assertEquals(result.exitCode, 0);
      assertEquals(JSON.parse(result.output), 3);
    });
  });

  describe("object operations", () => {
    it("converts to entries", async () => {
      const result = await jqExec("to_entries", '{"a":1,"b":2}');
      assertEquals(result.exitCode, 0);
      const entries = JSON.parse(result.output);
      assertEquals(entries.length, 2);
      assertEquals(entries.some((e: { key: string; value: number }) => e.key === "a" && e.value === 1), true);
      assertEquals(entries.some((e: { key: string; value: number }) => e.key === "b" && e.value === 2), true);
    });

    it("converts from entries", async () => {
      const result = await jqExec(
        "from_entries",
        '[{"key":"a","value":1},{"key":"b","value":2}]',
      );
      assertEquals(result.exitCode, 0);
      assertEquals(JSON.parse(result.output), { a: 1, b: 2 });
    });

    it("checks if key exists", async () => {
      const result = await jqExec('has("name")', '{"name":"John","age":30}');
      assertEquals(result.exitCode, 0);
      assertEquals(JSON.parse(result.output), true);
    });

    it("checks if key does not exist", async () => {
      const result = await jqExec('has("email")', '{"name":"John","age":30}');
      assertEquals(result.exitCode, 0);
      assertEquals(JSON.parse(result.output), false);
    });
  });

  describe("pipes", () => {
    it("chains operations with pipe", async () => {
      const result = await jqExec(".items[] | .name", '{"items":[{"name":"Alice"},{"name":"Bob"}]}');
      assertEquals(result.exitCode, 0);
      const lines = result.output.split("\n");
      assertEquals(lines.length, 2);
      assertEquals(JSON.parse(lines[0]!), "Alice");
      assertEquals(JSON.parse(lines[1]!), "Bob");
    });

    it("chains select and field access", async () => {
      const result = await jqExec(
        ".[] | select(.age > 18) | .name",
        '[{"name":"Alice","age":25},{"name":"Bob","age":15},{"name":"Charlie","age":30}]',
      );
      assertEquals(result.exitCode, 0);
      const lines = result.output.split("\n");
      assertEquals(lines.length, 2);
      assertEquals(JSON.parse(lines[0]!), "Alice");
      assertEquals(JSON.parse(lines[1]!), "Charlie");
    });

    it("chains multiple transformations", async () => {
      const result = await jqExec(".[] | .value | . * 2", '[{"value":5},{"value":10}]');
      assertEquals(result.exitCode, 0);
      const lines = result.output.split("\n");
      assertEquals(lines.length, 2);
      assertEquals(JSON.parse(lines[0]!), 10);
      assertEquals(JSON.parse(lines[1]!), 20);
    });
  });

  describe("options", () => {
    it("outputs raw strings with -r", async () => {
      const result = await jqExec(".message", '{"message":"Hello World"}', {
        raw: true,
      });
      assertEquals(result.exitCode, 0);
      assertEquals(result.output, "Hello World");
    });

    it("outputs compact JSON with -c", async () => {
      const result = await jqExec(".", '{"name":"John","age":30}', {
        compact: true,
      });
      assertEquals(result.exitCode, 0);
      assertEquals(result.output.includes("\n"), false);
      assertEquals(JSON.parse(result.output), { name: "John", age: 30 });
    });

    it("sorts keys in output", async () => {
      const result = await jqExec(".", '{"c":3,"a":1,"b":2}', {
        sortKeys: true,
      });
      assertEquals(result.exitCode, 0);
      assertStringIncludes(result.output, '"a"');
      // In sorted output, "a" should appear before "b" and "c"
      const aIndex = result.output.indexOf('"a"');
      const bIndex = result.output.indexOf('"b"');
      const cIndex = result.output.indexOf('"c"');
      assertEquals(aIndex < bIndex, true);
      assertEquals(bIndex < cIndex, true);
    });
  });

  describe("error handling", () => {
    it("handles invalid JSON", async () => {
      const result = await jqExec(".", "not json");
      assertEquals(result.exitCode, 1);
      assertStringIncludes(result.output, "error");
    });

    it("handles unknown query token", async () => {
      const result = await jqExec(".invalid_function()", '{"a":1}');
      assertEquals(result.exitCode, 1);
      assertStringIncludes(result.output, "error");
    });

    it("exits on error with exitOnError option", async () => {
      const result = await jqExec(".", "invalid", { exitOnError: true });
      assertEquals(result.exitCode, 1);
      assertEquals(result.error !== undefined, true);
    });
  });

  describe("complex queries", () => {
    it("filters and maps array", async () => {
      const input = JSON.stringify([
        { name: "Alice", age: 25, active: true },
        { name: "Bob", age: 15, active: true },
        { name: "Charlie", age: 30, active: false },
      ]);
      const result = await jqExec(
        ".[] | select(.active and .age > 18) | .name",
        input,
      );
      assertEquals(result.exitCode, 0);
      assertEquals(result.output.trim(), '"Alice"');
    });

    it("extracts nested arrays", async () => {
      const input = JSON.stringify({
        users: [
          { name: "Alice", tags: ["admin", "user"] },
          { name: "Bob", tags: ["user"] },
        ],
      });
      const result = await jqExec(".users[] | .tags[]", input);
      assertEquals(result.exitCode, 0);
      const lines = result.output.split("\n");
      assertEquals(lines.length, 3);
      assertEquals(JSON.parse(lines[0]!), "admin");
      assertEquals(JSON.parse(lines[1]!), "user");
      assertEquals(JSON.parse(lines[2]!), "user");
    });

    it("groups and transforms", async () => {
      const result = await jqExec(
        "group_by(.category) | map(length)",
        '[{"category":"A"},{"category":"B"},{"category":"A"},{"category":"A"}]',
      );
      assertEquals(result.exitCode, 0);
      const lengths = JSON.parse(result.output);
      assertEquals(lengths.sort(), [1, 3]);
    });
  });
});
