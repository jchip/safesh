import { assertEquals } from "@std/assert";
import {
  FLUENT_COMMAND_NAMES,
  getFluentCommandCapability,
  getGrepCommandCapability,
  getSimpleTransformCapability,
} from "./command-capabilities.ts";
import { isFluentCommand } from "./types.ts";

Deno.test("command capability registry drives fluent command names", () => {
  assertEquals(FLUENT_COMMAND_NAMES.has("grep"), true);
  assertEquals(FLUENT_COMMAND_NAMES.has("wc"), true);
  assertEquals(FLUENT_COMMAND_NAMES.has("tee"), false);
  assertEquals(isFluentCommand("grep"), true);
  assertEquals(isFluentCommand("tee"), false);
});

Deno.test("command capability registry records grep fallback flags", () => {
  const grep = getGrepCommandCapability();

  assertEquals(grep.invertShortFlags, ["v"]);
  assertEquals(grep.ignoreCaseShortFlags, ["i"]);
  assertEquals(grep.lineNumberShortFlags, ["n"]);
  assertEquals(grep.recursiveShortFlags, ["r", "R"]);
  assertEquals(grep.unsupportedShortFlags, ["A", "B", "C", "c", "m", "q"]);
});

Deno.test("command capability registry records simple transform stream modes", () => {
  assertEquals(getSimpleTransformCapability("head")?.inputMode, "line");
  assertEquals(getSimpleTransformCapability("head")?.unsupportedShortFlags, ["c"]);
  assertEquals(getSimpleTransformCapability("wc")?.inputMode, "raw");
  assertEquals(getSimpleTransformCapability("wc")?.requiresRawInput, true);
  assertEquals(getFluentCommandCapability("cat")?.outputMode, "raw-stream");
});
