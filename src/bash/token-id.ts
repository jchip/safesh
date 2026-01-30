/**
 * Branded type for unique token identifiers.
 * Used to track tokens and their positions throughout parsing.
 */
export type TokenId = number & { readonly __brand: 'TokenId' };

/**
 * Create a TokenId from a number.
 * @internal - prefer using IdGenerator.next()
 */
export function createTokenId(n: number): TokenId {
  return n as TokenId;
}

/**
 * Generates unique sequential token IDs for a parse session.
 */
export class IdGenerator {
  private nextId = 0;

  /**
   * Generate the next unique TokenId.
   */
  next(): TokenId {
    return createTokenId(this.nextId++);
  }

  /**
   * Reset the generator (for testing).
   */
  reset(): void {
    this.nextId = 0;
  }

  /**
   * Get current count (for debugging).
   */
  get count(): number {
    return this.nextId;
  }
}
