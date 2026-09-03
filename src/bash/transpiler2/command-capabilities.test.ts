import { assertEquals } from "@std/assert";
import {
  FLUENT_COMMAND_NAMES,
  getFluentCommandCapability,
  getSimpleTransformCapability,
} from "./command-capabilities.ts";
import { isFluentCommand } from "./types.ts";

Deno.test("command capability registry drives fluent command names", () => {
  assertEquals(FLUENT_COMMAND_NAMES.has("wc"), true);
  assertEquals(FLUENT_COMMAND_NAMES.has("tee"), false);
  assertEquals(isFluentCommand("tee"), false);
});

Deno.test("SSH-675: grep is not a fluent command — it lowers to the real binary", () => {
  assertEquals(FLUENT_COMMAND_NAMES.has("grep"), false);
  assertEquals(isFluentCommand("grep"), false);
  assertEquals(getFluentCommandCapability("grep"), undefined);
});

Deno.test("command capability registry records simple transform stream modes", () => {
  assertEquals(getSimpleTransformCapability("head")?.inputMode, "line");
  assertEquals(getSimpleTransformCapability("head")?.unsupportedShortFlags, ["c"]);
  assertEquals(getSimpleTransformCapability("wc")?.inputMode, "raw");
  assertEquals(getSimpleTransformCapability("wc")?.requiresRawInput, true);
  assertEquals(getFluentCommandCapability("cat")?.outputMode, "raw-stream");
});
