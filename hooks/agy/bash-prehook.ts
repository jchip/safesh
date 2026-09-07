#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run --allow-env --allow-net
/** Antigravity CLI (agy) SafeShell Bash hook entrypoint. */

import { main } from "../bash-prehook.ts";

await main();
