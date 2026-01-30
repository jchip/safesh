import type { TokenId } from "./token-id.ts";
import type { SourceLocation } from "./ast.ts";

/**
 * Maps token IDs to their source locations.
 * Used for error reporting and source mapping.
 */
export class PositionMap {
  private map: Map<TokenId, SourceLocation> = new Map();

  /**
   * Record a token's location.
   */
  set(id: TokenId, loc: SourceLocation): void {
    this.map.set(id, loc);
  }

  /**
   * Get a token's location.
   */
  get(id: TokenId): SourceLocation | undefined {
    return this.map.get(id);
  }

  /**
   * Check if a token has a recorded location.
   */
  has(id: TokenId): boolean {
    return this.map.has(id);
  }

  /**
   * Get the span covering multiple tokens.
   * Returns the location from first token's start to last token's end.
   */
  span(startId: TokenId, endId: TokenId): SourceLocation | undefined {
    const start = this.map.get(startId);
    const end = this.map.get(endId);
    if (!start || !end) return undefined;
    return {
      start: start.start,
      end: end.end,
    };
  }

  /**
   * Get number of recorded positions.
   */
  get size(): number {
    return this.map.size;
  }

  /**
   * Clear all recorded positions.
   */
  clear(): void {
    this.map.clear();
  }

  /**
   * Iterate over all entries.
   */
  entries(): IterableIterator<[TokenId, SourceLocation]> {
    return this.map.entries();
  }
}
