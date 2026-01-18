/**
 * I/O Utilities
 *
 * Provides utilities for input/output operations.
 */

/**
 * Read stdin completely and return as string
 *
 * Reads all chunks from stdin and combines them into a single string.
 * Handles binary data properly by accumulating chunks before decoding.
 *
 * @returns Promise resolving to the complete stdin content as a string
 */
export async function readStdinFully(): Promise<string> {
  const decoder = new TextDecoder();
  const chunks: Uint8Array[] = [];

  for await (const chunk of Deno.stdin.readable) {
    chunks.push(chunk);
  }

  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }

  return decoder.decode(combined);
}
