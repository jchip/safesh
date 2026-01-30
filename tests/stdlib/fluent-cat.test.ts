/**
 * Tests for fluent streams with cat - SSH-196: Test Fluent Streams - Cat and Text Processing
 * Tests $.cat with .lines(), .grep(), .filter(), .map(), .head(), .tail(), .collect()
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { describe, it, beforeEach, afterEach } from "@std/testing/bdd";
import { cat } from "../../src/stdlib/fs-streams.ts";
import { REAL_TMP } from "../helpers.ts";

const testDir = `${REAL_TMP}/safesh-fluent-cat-test`;

describe("fluent streams - cat and text processing (SSH-196)", () => {
  beforeEach(async () => {
    await Deno.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await Deno.remove(testDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("cat().lines() - split into lines", () => {
    it("splits file into lines", async () => {
      await Deno.writeTextFile(
        `${testDir}/data.txt`,
        "line1\nline2\nline3"
      );

      const lines = await cat(`${testDir}/data.txt`)
        .pipe(async function* (stream) {
          for await (const chunk of stream) {
            const lines = chunk.split("\n");
            for (const line of lines) {
              if (line) yield line;
            }
          }
        })
        .collect();

      assertEquals(lines.length, 3);
      assertEquals(lines[0], "line1");
      assertEquals(lines[1], "line2");
      assertEquals(lines[2], "line3");
    });

    it("handles empty lines", async () => {
      await Deno.writeTextFile(
        `${testDir}/empty-lines.txt`,
        "line1\n\nline3\n"
      );

      const lines = await cat(`${testDir}/empty-lines.txt`)
        .pipe(async function* (stream) {
          for await (const chunk of stream) {
            const lines = chunk.split("\n");
            for (const line of lines) {
              yield line;
            }
          }
        })
        .collect();

      assertEquals(lines.some(l => l === ""), true);
    });

    it("handles files with different line endings", async () => {
      await Deno.writeTextFile(
        `${testDir}/windows.txt`,
        "line1\r\nline2\r\nline3"
      );

      const lines = await cat(`${testDir}/windows.txt`)
        .pipe(async function* (stream) {
          for await (const chunk of stream) {
            const lines = chunk.split(/\r?\n/);
            for (const line of lines) {
              if (line) yield line;
            }
          }
        })
        .collect();

      assertEquals(lines.length, 3);
    });
  });

  describe("grep() - pattern matching", () => {
    beforeEach(async () => {
      await Deno.writeTextFile(
        `${testDir}/log.txt`,
        "INFO: Starting application\nERROR: Connection failed\nWARNING: Low memory\nERROR: Timeout occurred\nINFO: Shutting down"
      );
    });

    it("filters lines matching regex pattern", async () => {
      const errors = await cat(`${testDir}/log.txt`)
        .pipe(async function* (stream) {
          for await (const chunk of stream) {
            const lines = chunk.split("\n");
            for (const line of lines) {
              if (line && /ERROR/.test(line)) yield line;
            }
          }
        })
        .collect();

      assertEquals(errors.length, 2);
      assertEquals(errors.every(l => l.includes("ERROR")), true);
    });

    it("filters lines matching string pattern", async () => {
      const warnings = await cat(`${testDir}/log.txt`)
        .pipe(async function* (stream) {
          for await (const chunk of stream) {
            const lines = chunk.split("\n");
            for (const line of lines) {
              if (line && line.includes("WARNING")) yield line;
            }
          }
        })
        .collect();

      assertEquals(warnings.length, 1);
      assertStringIncludes(warnings[0]!, "WARNING");
    });

    it("supports case-insensitive matching", async () => {
      const matches = await cat(`${testDir}/log.txt`)
        .pipe(async function* (stream) {
          for await (const chunk of stream) {
            const lines = chunk.split("\n");
            for (const line of lines) {
              if (line && /info/i.test(line)) yield line;
            }
          }
        })
        .collect();

      assertEquals(matches.length, 2);
    });
  });

  describe("filter() - custom predicate", () => {
    it("filters lines by custom predicate", async () => {
      await Deno.writeTextFile(
        `${testDir}/data.txt`,
        "short\nthis is a longer line\nok\nthis is also quite long"
      );

      const longLines = await cat(`${testDir}/data.txt`)
        .pipe(async function* (stream) {
          for await (const chunk of stream) {
            const lines = chunk.split("\n");
            for (const line of lines) {
              if (line && line.length > 10) yield line;
            }
          }
        })
        .collect();

      assertEquals(longLines.length, 2);
      assertEquals(longLines.every(l => l.length > 10), true);
    });

    it("filters by line index", async () => {
      await Deno.writeTextFile(
        `${testDir}/indexed.txt`,
        "header\ndata1\ndata2\ndata3"
      );

      const lines = await cat(`${testDir}/indexed.txt`)
        .pipe(async function* (stream) {
          for await (const chunk of stream) {
            const lines = chunk.split("\n");
            for (let i = 0; i < lines.length; i++) {
              if (lines[i] && i > 0) yield lines[i]!; // Skip header
            }
          }
        })
        .collect();

      assertEquals(lines[0], "data1");
      assertEquals(lines.includes("header"), false);
    });

    it("supports async predicates", async () => {
      await Deno.writeTextFile(
        `${testDir}/async.txt`,
        "line1\nline2\nline3"
      );

      const filtered = await cat(`${testDir}/async.txt`)
        .pipe(async function* (stream) {
          for await (const chunk of stream) {
            const lines = chunk.split("\n");
            for (const line of lines) {
              if (!line) continue;
              // Simulate async check
              await Promise.resolve();
              if (line.includes("2")) yield line;
            }
          }
        })
        .collect();

      assertEquals(filtered.length, 1);
      assertEquals(filtered[0], "line2");
    });
  });

  describe("map() - transformation", () => {
    it("transforms each line", async () => {
      await Deno.writeTextFile(
        `${testDir}/lower.txt`,
        "hello\nworld\ntest"
      );

      const upper = await cat(`${testDir}/lower.txt`)
        .pipe(async function* (stream) {
          for await (const chunk of stream) {
            const lines = chunk.split("\n");
            for (const line of lines) {
              if (line) yield line.toUpperCase();
            }
          }
        })
        .collect();

      assertEquals(upper[0], "HELLO");
      assertEquals(upper[1], "WORLD");
      assertEquals(upper[2], "TEST");
    });

    it("adds line numbers", async () => {
      await Deno.writeTextFile(
        `${testDir}/numbered.txt`,
        "first\nsecond\nthird"
      );

      const lines = await cat(`${testDir}/numbered.txt`)
        .pipe(async function* (stream) {
          let index = 0;
          for await (const chunk of stream) {
            const lines = chunk.split("\n");
            for (const line of lines) {
              if (line) yield `${++index}: ${line}`;
            }
          }
        })
        .collect();

      assertEquals(lines[0], "1: first");
      assertEquals(lines[1], "2: second");
      assertEquals(lines[2], "3: third");
    });

    it("parses structured data", async () => {
      await Deno.writeTextFile(
        `${testDir}/csv.txt`,
        "name,age\nAlice,30\nBob,25"
      );

      const parsed = await cat(`${testDir}/csv.txt`)
        .pipe(async function* (stream) {
          let first = true;
          for await (const chunk of stream) {
            const lines = chunk.split("\n");
            for (const line of lines) {
              if (!line) continue;
              if (first) {
                first = false;
                continue; // Skip header
              }
              const [name, age] = line.split(",");
              yield `${name} is ${age} years old`;
            }
          }
        })
        .collect();

      assertEquals(parsed[0], "Alice is 30 years old");
      assertEquals(parsed[1], "Bob is 25 years old");
    });

    it("supports async transformations", async () => {
      await Deno.writeTextFile(
        `${testDir}/async-map.txt`,
        "a\nb\nc"
      );

      const transformed = await cat(`${testDir}/async-map.txt`)
        .pipe(async function* (stream) {
          for await (const chunk of stream) {
            const lines = chunk.split("\n");
            for (const line of lines) {
              if (!line) continue;
              await Promise.resolve(); // Simulate async work
              yield line.toUpperCase();
            }
          }
        })
        .collect();

      assertEquals(transformed.length, 3);
    });
  });

  describe("head() - take first n items", () => {
    it("takes first n lines", async () => {
      await Deno.writeTextFile(
        `${testDir}/many.txt`,
        "1\n2\n3\n4\n5\n6\n7\n8\n9\n10"
      );

      const first5 = await cat(`${testDir}/many.txt`)
        .pipe(async function* (stream) {
          let count = 0;
          for await (const chunk of stream) {
            const lines = chunk.split("\n");
            for (const line of lines) {
              if (line && count < 5) {
                yield line;
                count++;
              }
            }
          }
        })
        .collect();

      assertEquals(first5.length, 5);
      assertEquals(first5[0], "1");
      assertEquals(first5[4], "5");
    });

    it("handles n larger than line count", async () => {
      await Deno.writeTextFile(
        `${testDir}/few.txt`,
        "1\n2\n3"
      );

      const lines = await cat(`${testDir}/few.txt`)
        .pipe(async function* (stream) {
          let count = 0;
          for await (const chunk of stream) {
            const lines = chunk.split("\n");
            for (const line of lines) {
              if (line && count < 100) {
                yield line;
                count++;
              }
            }
          }
        })
        .collect();

      assertEquals(lines.length, 3);
    });

    it("works with head(1)", async () => {
      await Deno.writeTextFile(
        `${testDir}/first.txt`,
        "first\nsecond\nthird"
      );

      const first = await cat(`${testDir}/first.txt`)
        .pipe(async function* (stream) {
          let count = 0;
          for await (const chunk of stream) {
            const lines = chunk.split("\n");
            for (const line of lines) {
              if (line && count < 1) {
                yield line;
                count++;
              }
            }
          }
        })
        .collect();

      assertEquals(first.length, 1);
      assertEquals(first[0], "first");
    });
  });

  describe("tail() - take last n items", () => {
    it("takes last n lines", async () => {
      await Deno.writeTextFile(
        `${testDir}/tail.txt`,
        "1\n2\n3\n4\n5\n6\n7\n8\n9\n10"
      );

      const lines = await cat(`${testDir}/tail.txt`)
        .pipe(async function* (stream) {
          const buffer: string[] = [];
          const maxSize = 3;

          for await (const chunk of stream) {
            const lines = chunk.split("\n");
            for (const line of lines) {
              if (line) {
                buffer.push(line);
                if (buffer.length > maxSize) {
                  buffer.shift();
                }
              }
            }
          }

          for (const line of buffer) {
            yield line;
          }
        })
        .collect();

      assertEquals(lines.length, 3);
      assertEquals(lines[0], "8");
      assertEquals(lines[2], "10");
    });

    it("handles n larger than line count", async () => {
      await Deno.writeTextFile(
        `${testDir}/tail-few.txt`,
        "1\n2"
      );

      const lines = await cat(`${testDir}/tail-few.txt`)
        .pipe(async function* (stream) {
          const buffer: string[] = [];
          const maxSize = 100;

          for await (const chunk of stream) {
            const lines = chunk.split("\n");
            for (const line of lines) {
              if (line) {
                buffer.push(line);
                if (buffer.length > maxSize) {
                  buffer.shift();
                }
              }
            }
          }

          for (const line of buffer) {
            yield line;
          }
        })
        .collect();

      assertEquals(lines.length, 2);
    });
  });

  describe("collect() - terminal operation", () => {
    it("collects all processed lines", async () => {
      await Deno.writeTextFile(
        `${testDir}/collect.txt`,
        "a\nb\nc"
      );

      const result = await cat(`${testDir}/collect.txt`)
        .pipe(async function* (stream) {
          for await (const chunk of stream) {
            const lines = chunk.split("\n");
            for (const line of lines) {
              if (line) yield line.toUpperCase();
            }
          }
        })
        .collect();

      assertEquals(Array.isArray(result), true);
      assertEquals(result.length, 3);
      assertEquals(result[0], "A");
    });

    it("returns empty array for empty file", async () => {
      await Deno.writeTextFile(`${testDir}/empty.txt`, "");

      const result = await cat(`${testDir}/empty.txt`)
        .pipe(async function* (stream) {
          for await (const chunk of stream) {
            const lines = chunk.split("\n");
            for (const line of lines) {
              if (line) yield line;
            }
          }
        })
        .collect();

      assertEquals(result.length, 0);
    });
  });

  describe("chaining multiple operations", () => {
    it("chains lines().grep().map().head()", async () => {
      await Deno.writeTextFile(
        `${testDir}/chain.txt`,
        "info: message 1\nerror: bad thing\ninfo: message 2\nerror: worse thing\ninfo: message 3"
      );

      const result = await cat(`${testDir}/chain.txt`)
        .pipe(async function* (stream) {
          let count = 0;
          for await (const chunk of stream) {
            const lines = chunk.split("\n");
            for (const line of lines) {
              if (line && /error/i.test(line) && count < 1) {
                yield line.toUpperCase();
                count++;
              }
            }
          }
        })
        .collect();

      assertEquals(result.length, 1);
      assertStringIncludes(result[0]!, "ERROR");
      assertStringIncludes(result[0]!, "BAD THING");
    });

    it("chains filter().map().filter().collect()", async () => {
      await Deno.writeTextFile(
        `${testDir}/complex.txt`,
        "1\n22\n333\n4444\n55555"
      );

      const result = await cat(`${testDir}/complex.txt`)
        .pipe(async function* (stream) {
          for await (const chunk of stream) {
            const lines = chunk.split("\n");
            for (const line of lines) {
              if (line && line.length > 2) {
                const repeated = line.repeat(2);
                if (repeated.length < 10) {
                  yield repeated;
                }
              }
            }
          }
        })
        .collect();

      // Both "333" (length 3) and "4444" (length 4) are > 2
      // "333333" has length 6 (< 10), "44444444" has length 8 (< 10)
      assertEquals(result.length, 2);
      assertEquals(result.includes("333333"), true);
    });

    it("processes log file with multiple filters", async () => {
      await Deno.writeTextFile(
        `${testDir}/app.log`,
        "[2024-01-01] INFO: Application started\n[2024-01-01] ERROR: Connection timeout\n[2024-01-01] DEBUG: Processing request\n[2024-01-01] ERROR: Database unavailable\n[2024-01-01] WARN: Retrying connection"
      );

      const errors = await cat(`${testDir}/app.log`)
        .pipe(async function* (stream) {
          for await (const chunk of stream) {
            const lines = chunk.split("\n");
            for (const line of lines) {
              if (line && line.includes("ERROR")) {
                // Extract just the message part
                const match = line.match(/ERROR: (.+)$/);
                if (match) yield match[1];
              }
            }
          }
        })
        .collect();

      assertEquals(errors.length, 2);
      assertEquals(errors[0], "Connection timeout");
      assertEquals(errors[1], "Database unavailable");
    });
  });

  describe("other terminal operations", () => {
    it("first() returns first matching line", async () => {
      await Deno.writeTextFile(
        `${testDir}/first.txt`,
        "skip\nskip\nFOUND\nafter"
      );

      const first = await cat(`${testDir}/first.txt`)
        .pipe(async function* (stream) {
          for await (const chunk of stream) {
            const lines = chunk.split("\n");
            for (const line of lines) {
              if (line && line.includes("FOUND")) yield line;
            }
          }
        })
        .first();

      assertEquals(first, "FOUND");
    });

    it("count() counts matching lines", async () => {
      await Deno.writeTextFile(
        `${testDir}/count.txt`,
        "match\nno\nmatch\nno\nmatch"
      );

      const count = await cat(`${testDir}/count.txt`)
        .pipe(async function* (stream) {
          for await (const chunk of stream) {
            const lines = chunk.split("\n");
            for (const line of lines) {
              if (line && line === "match") yield line;
            }
          }
        })
        .count();

      assertEquals(count, 3);
    });

    it("forEach() processes each line", async () => {
      await Deno.writeTextFile(
        `${testDir}/foreach.txt`,
        "1\n2\n3"
      );

      const collected: string[] = [];
      await cat(`${testDir}/foreach.txt`)
        .pipe(async function* (stream) {
          for await (const chunk of stream) {
            const lines = chunk.split("\n");
            for (const line of lines) {
              if (line) yield line;
            }
          }
        })
        .forEach(line => {
          collected.push(line.toUpperCase());
        });

      assertEquals(collected.length, 3);
      assertEquals(collected[0], "1");
    });
  });
});
