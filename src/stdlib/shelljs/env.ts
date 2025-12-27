/**
 * env - Environment variable access
 *
 * @module
 */

/**
 * Environment variable proxy
 *
 * Provides convenient access to environment variables with
 * property-style access.
 *
 * @example
 * ```ts
 * // Get environment variable
 * const path = env.PATH;
 * const home = env.HOME;
 *
 * // Set environment variable
 * env.MY_VAR = "value";
 *
 * // Check if variable exists
 * if (env.DEBUG) {
 *   console.log("Debug mode");
 * }
 * ```
 */
export const env: Record<string, string | undefined> = new Proxy(
  {} as Record<string, string | undefined>,
  {
    get(_target, prop: string) {
      return Deno.env.get(prop);
    },

    set(_target, prop: string, value: string) {
      Deno.env.set(prop, value);
      return true;
    },

    has(_target, prop: string) {
      return Deno.env.get(prop) !== undefined;
    },

    deleteProperty(_target, prop: string) {
      Deno.env.delete(prop);
      return true;
    },

    ownKeys(_target) {
      return Object.keys(Deno.env.toObject());
    },

    getOwnPropertyDescriptor(_target, prop: string) {
      const value = Deno.env.get(prop);
      if (value !== undefined) {
        return {
          value,
          writable: true,
          enumerable: true,
          configurable: true,
        };
      }
      return undefined;
    },
  },
);

/**
 * Get environment variable with default value
 *
 * @param name - Variable name
 * @param defaultValue - Default if not set
 * @returns Variable value or default
 */
export function getEnv(name: string, defaultValue?: string): string | undefined {
  return Deno.env.get(name) ?? defaultValue;
}

/**
 * Set environment variable
 *
 * @param name - Variable name
 * @param value - Value to set
 */
export function setEnv(name: string, value: string): void {
  Deno.env.set(name, value);
}

/**
 * Delete environment variable
 *
 * @param name - Variable name
 */
export function deleteEnv(name: string): void {
  Deno.env.delete(name);
}

/**
 * Get all environment variables as object
 *
 * @returns Record of all environment variables
 */
export function getAllEnv(): Record<string, string> {
  return Deno.env.toObject();
}
