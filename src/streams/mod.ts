/**
 * Streaming API
 *
 * Gulp-like streaming primitives using Deno's native streams.
 *
 * @module
 */

// TODO: Implement after SSH-23, SSH-24, SSH-25

export function src(_pattern: string): ReadableStream<string> {
  // TODO: Implement glob-based file source
  throw new Error("Not implemented");
}

export function dest(_path: string): WritableStream<string> {
  // TODO: Implement file destination
  throw new Error("Not implemented");
}

export function transform<T, U>(
  _fn: (chunk: T) => U | Promise<U>,
): TransformStream<T, U> {
  // TODO: Implement transform
  throw new Error("Not implemented");
}

export function filter<T>(
  _predicate: (chunk: T) => boolean | Promise<boolean>,
): TransformStream<T, T> {
  // TODO: Implement filter
  throw new Error("Not implemented");
}
