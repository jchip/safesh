/**
 * File system utilities
 *
 * All functions respect the sandbox and throw SafeShellError on violations.
 *
 * @module
 */

// TODO: Implement after SSH-20
// For now, re-export from @std/fs with sandbox wrappers

export async function read(path: string): Promise<string> {
  // TODO: Add sandbox validation
  return await Deno.readTextFile(path);
}

export async function write(path: string, content: string): Promise<void> {
  // TODO: Add sandbox validation
  await Deno.writeTextFile(path, content);
}

export async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

export async function remove(path: string, options?: { recursive?: boolean }): Promise<void> {
  // TODO: Add sandbox validation
  await Deno.remove(path, options);
}

export async function mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
  // TODO: Add sandbox validation
  await Deno.mkdir(path, options);
}

export async function copy(src: string, dest: string): Promise<void> {
  // TODO: Add sandbox validation
  // TODO: Use @std/fs copy
  const content = await Deno.readFile(src);
  await Deno.writeFile(dest, content);
}

export async function move(src: string, dest: string): Promise<void> {
  // TODO: Add sandbox validation
  await Deno.rename(src, dest);
}
