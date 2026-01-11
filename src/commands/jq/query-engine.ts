/**
 * JSON Query Engine
 *
 * Implements a jq-like query language for JSON data manipulation.
 * Supports path traversal, filtering, mapping, and common operations.
 *
 * @module
 */

// =============================================================================
// Types
// =============================================================================

/**
 * JSON value type
 */
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

/**
 * Symbol to mark iteration results (multiple values from .[] or similar)
 */
export const ITERATION_MARKER = Symbol("iteration");

/**
 * Wrapper for iteration results - multiple values that should be output as separate lines
 */
export class IterationResult {
  readonly [ITERATION_MARKER] = true;
  constructor(public readonly values: JsonValue[]) {}
}

/**
 * Token result - single value or array of values (from .[] or similar)
 */
type TokenResult = JsonValue | JsonValue[];

/**
 * Query result - can be single value or iteration result (multiple values)
 */
export type QueryResult = JsonValue | IterationResult;

/**
 * Check if a result is an iteration result
 */
export function isIterationResult(result: QueryResult): result is IterationResult {
  return result instanceof IterationResult;
}

// =============================================================================
// Query Parser
// =============================================================================

/**
 * Parse a jq-like query into tokens
 */
export function parseQuery(query: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inBracket = false;
  let parenDepth = 0;

  for (let i = 0; i < query.length; i++) {
    const char = query[i];

    if (char === "|" && !inBracket && parenDepth === 0) {
      if (current.trim()) {
        tokens.push(current.trim());
      }
      current = "";
    } else if (char === "[") {
      inBracket = true;
      current += char;
    } else if (char === "]") {
      inBracket = false;
      current += char;
    } else if (char === "(") {
      parenDepth++;
      current += char;
    } else if (char === ")") {
      parenDepth--;
      current += char;
    } else {
      current += char;
    }
  }

  if (current.trim()) {
    tokens.push(current.trim());
  }

  return tokens.length > 0 ? tokens : ["."];
}

// =============================================================================
// Query Execution
// =============================================================================

/**
 * Execute a single query token on data
 */
function executeToken(data: JsonValue, token: string): TokenResult {
  // Identity - return the whole object
  if (token === ".") {
    return data;
  }

  // keys - get object keys
  if (token === "keys") {
    if (data === null || typeof data !== "object" || Array.isArray(data)) {
      throw new Error("keys can only be used on objects");
    }
    return Object.keys(data).sort();
  }

  // keys_unsorted - get object keys without sorting
  if (token === "keys_unsorted") {
    if (data === null || typeof data !== "object" || Array.isArray(data)) {
      throw new Error("keys_unsorted can only be used on objects");
    }
    return Object.keys(data);
  }

  // values - get object values or array elements
  if (token === "values") {
    if (Array.isArray(data)) {
      return data;
    }
    if (data !== null && typeof data === "object") {
      return Object.values(data);
    }
    throw new Error("values can only be used on objects or arrays");
  }

  // length - get length/size
  if (token === "length") {
    if (data === null) return 0;
    if (typeof data === "string") return data.length;
    if (Array.isArray(data)) return data.length;
    if (typeof data === "object") return Object.keys(data).length;
    throw new Error("length can only be used on strings, arrays, or objects");
  }

  // type - get type name
  if (token === "type") {
    if (data === null) return "null";
    if (Array.isArray(data)) return "array";
    return typeof data;
  }

  // empty - return no results
  if (token === "empty") {
    return [];
  }

  // not - boolean negation
  if (token === "not") {
    return !data;
  }

  // Array iteration: .[]
  if (token === ".[]") {
    if (!Array.isArray(data)) {
      throw new Error(".[] can only be used on arrays");
    }
    return data;
  }

  // Array index: .[N]
  const arrayIndexMatch = token.match(/^\.\[(-?\d+)\]$/);
  if (arrayIndexMatch && arrayIndexMatch[1]) {
    const index = parseInt(arrayIndexMatch[1], 10);
    if (!Array.isArray(data)) {
      throw new Error("array index can only be used on arrays");
    }
    const actualIndex = index < 0 ? data.length + index : index;
    return data[actualIndex] ?? null;
  }

  // Array slice: .[start:end]
  const sliceMatch = token.match(/^\.\[(-?\d+)?:(-?\d+)?\]$/);
  if (sliceMatch) {
    if (!Array.isArray(data)) {
      throw new Error("array slice can only be used on arrays");
    }
    const start = sliceMatch[1] ? parseInt(sliceMatch[1], 10) : 0;
    const end = sliceMatch[2] ? parseInt(sliceMatch[2], 10) : data.length;
    return data.slice(start, end);
  }

  // Field access with optional iteration: .field or .field[]
  const fieldIterMatch = token.match(/^\.([a-zA-Z_][a-zA-Z0-9_]*)\[\]$/);
  if (fieldIterMatch && fieldIterMatch[1]) {
    const field = fieldIterMatch[1];
    if (data === null || typeof data !== "object" || Array.isArray(data)) {
      return null;
    }
    const value = (data as Record<string, JsonValue>)[field];
    if (!Array.isArray(value)) {
      throw new Error(`${field}[] can only be used when field is an array`);
    }
    return value;
  }

  // Arithmetic operations: . * N, . + N, . - N, . / N (check before field access)
  const arithMatch = token.match(/^\.\s*([+\-*/])\s*(\d+(?:\.\d+)?)$/);
  if (arithMatch && arithMatch[1] && arithMatch[2]) {
    const op = arithMatch[1];
    const num = parseFloat(arithMatch[2]);
    if (typeof data !== "number") {
      throw new Error(`Arithmetic operations require a number, got ${typeof data}`);
    }
    switch (op) {
      case "+":
        return data + num;
      case "-":
        return data - num;
      case "*":
        return data * num;
      case "/":
        return data / num;
    }
  }

  // Simple field access: .field or .field.nested (only valid identifiers)
  const fieldAccessMatch = token.match(/^\.([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)*)$/);
  if (fieldAccessMatch && fieldAccessMatch[1]) {
    const path = fieldAccessMatch[1].split(".");
    let current: JsonValue = data;

    for (const segment of path) {
      if (segment === "") continue;

      // Regular field access
      if (current === null || typeof current !== "object" || Array.isArray(current)) {
        return null;
      }
      current = (current as Record<string, JsonValue>)[segment] ?? null;
    }
    return current;
  }

  // select(expr) - filter based on expression
  const selectMatch = token.match(/^select\((.+)\)$/);
  if (selectMatch && selectMatch[1]) {
    const expr = selectMatch[1];
    const result = evaluateCondition(data, expr);
    return result ? data : [];
  }

  // map(expr) - transform each element
  const mapMatch = token.match(/^map\((.+)\)$/);
  if (mapMatch && mapMatch[1]) {
    if (!Array.isArray(data)) {
      throw new Error("map can only be used on arrays");
    }
    const expr = mapMatch[1];
    return data.map((item) => {
      const result = executeQuery(item, expr);
      // If result is an array with single element from non-iteration, unwrap it
      return Array.isArray(result) && result.length === 1 ? result[0] : result;
    }) as JsonValue[];
  }

  // sort - sort array
  if (token === "sort") {
    if (!Array.isArray(data)) {
      throw new Error("sort can only be used on arrays");
    }
    return [...data].sort((a, b) => {
      if (typeof a === "number" && typeof b === "number") return a - b;
      if (typeof a === "string" && typeof b === "string") return a.localeCompare(b);
      return 0;
    });
  }

  // sort_by(expr) - sort array by expression
  const sortByMatch = token.match(/^sort_by\((.+)\)$/);
  if (sortByMatch && sortByMatch[1]) {
    if (!Array.isArray(data)) {
      throw new Error("sort_by can only be used on arrays");
    }
    const expr = sortByMatch[1];
    return [...data].sort((a, b) => {
      const aVal = executeQuery(a, expr);
      const bVal = executeQuery(b, expr);
      const aKey = Array.isArray(aVal) ? aVal[0] : aVal;
      const bKey = Array.isArray(bVal) ? bVal[0] : bVal;
      if (typeof aKey === "number" && typeof bKey === "number") return aKey - bKey;
      if (typeof aKey === "string" && typeof bKey === "string") return aKey.localeCompare(bKey);
      return 0;
    });
  }

  // reverse - reverse array
  if (token === "reverse") {
    if (!Array.isArray(data)) {
      throw new Error("reverse can only be used on arrays");
    }
    return [...data].reverse();
  }

  // unique - get unique elements
  if (token === "unique") {
    if (!Array.isArray(data)) {
      throw new Error("unique can only be used on arrays");
    }
    return [...new Set(data.map((v) => JSON.stringify(v)))].map((v) => JSON.parse(v));
  }

  // flatten - flatten array one level
  if (token === "flatten") {
    if (!Array.isArray(data)) {
      throw new Error("flatten can only be used on arrays");
    }
    return data.flat(1);
  }

  // flatten(depth) - flatten array to depth
  const flattenMatch = token.match(/^flatten\((\d+)\)$/);
  if (flattenMatch && flattenMatch[1]) {
    if (!Array.isArray(data)) {
      throw new Error("flatten can only be used on arrays");
    }
    const depth = parseInt(flattenMatch[1], 10);
    // Use recursive flatten instead of .flat() to avoid deep instantiation
    const flattenDeep = (arr: JsonValue[], d: number): JsonValue[] => {
      if (d === 0) return arr;
      return arr.reduce<JsonValue[]>((acc, val) => {
        if (Array.isArray(val)) {
          return acc.concat(flattenDeep(val, d - 1));
        }
        return acc.concat(val);
      }, []);
    };
    return flattenDeep(data, depth);
  }

  // min/max - get min/max value
  if (token === "min" || token === "max") {
    if (!Array.isArray(data)) {
      throw new Error(`${token} can only be used on arrays`);
    }
    if (data.length === 0) return null;
    const numbers = data.filter((v): v is number => typeof v === "number");
    if (numbers.length === 0) return null;
    return token === "min" ? Math.min(...numbers) : Math.max(...numbers);
  }

  // add - sum numbers or concatenate strings/arrays
  if (token === "add") {
    if (!Array.isArray(data)) {
      throw new Error("add can only be used on arrays");
    }
    if (data.length === 0) return null;
    if (data.every((v) => typeof v === "number")) {
      return (data as number[]).reduce((a, b) => a + b, 0);
    }
    if (data.every((v) => typeof v === "string")) {
      return (data as string[]).join("");
    }
    if (data.every((v) => Array.isArray(v))) {
      return (data as JsonValue[][]).flat(1);
    }
    throw new Error("add requires all elements to be numbers, strings, or arrays");
  }

  // first/last - get first/last element
  if (token === "first") {
    if (!Array.isArray(data)) return data;
    return data[0] ?? null;
  }
  if (token === "last") {
    if (!Array.isArray(data)) return data;
    return data[data.length - 1] ?? null;
  }

  // has(key) - check if key exists
  const hasMatch = token.match(/^has\(["'](.+)["']\)$/);
  if (hasMatch && hasMatch[1]) {
    const key = hasMatch[1];
    if (data === null || typeof data !== "object" || Array.isArray(data)) {
      return false;
    }
    return key in (data as Record<string, JsonValue>);
  }

  // to_entries - convert object to key-value pairs
  if (token === "to_entries") {
    if (data === null || typeof data !== "object" || Array.isArray(data)) {
      throw new Error("to_entries can only be used on objects");
    }
    return Object.entries(data).map(([key, value]) => ({ key, value }));
  }

  // from_entries - convert key-value pairs to object
  if (token === "from_entries") {
    if (!Array.isArray(data)) {
      throw new Error("from_entries can only be used on arrays");
    }
    const result: Record<string, JsonValue> = {};
    for (const item of data) {
      if (item !== null && typeof item === "object" && !Array.isArray(item)) {
        const obj = item as Record<string, JsonValue>;
        const key = obj.key ?? obj.name;
        const value = obj.value;
        if (typeof key === "string") {
          result[key] = value ?? null;
        }
      }
    }
    return result;
  }

  // group_by(expr) - group array elements by expression
  const groupByMatch = token.match(/^group_by\((.+)\)$/);
  if (groupByMatch && groupByMatch[1]) {
    if (!Array.isArray(data)) {
      throw new Error("group_by can only be used on arrays");
    }
    const expr = groupByMatch[1];
    const groups = new Map<string, JsonValue[]>();
    for (const item of data) {
      const key = executeQuery(item, expr);
      const keyStr = JSON.stringify(Array.isArray(key) ? key[0] : key);
      if (!groups.has(keyStr)) {
        groups.set(keyStr, []);
      }
      const group = groups.get(keyStr);
      if (group) {
        group.push(item);
      }
    }
    return Array.from(groups.values());
  }

  throw new Error(`Unknown query token: ${token}`);
}

/**
 * Evaluate a condition expression
 */
function evaluateCondition(data: JsonValue, expr: string): boolean {
  // Logical operators: and, or (check first, lowest precedence)
  const andMatch = expr.match(/^(.+?)\s+and\s+(.+)$/);
  if (andMatch && andMatch[1] && andMatch[2]) {
    return evaluateCondition(data, andMatch[1].trim()) &&
           evaluateCondition(data, andMatch[2].trim());
  }

  const orMatch = expr.match(/^(.+?)\s+or\s+(.+)$/);
  if (orMatch && orMatch[1] && orMatch[2]) {
    return evaluateCondition(data, orMatch[1].trim()) ||
           evaluateCondition(data, orMatch[2].trim());
  }

  // Comparison operators (check first before field existence)
  const compMatch = expr.match(/^(.+?)\s*(==|!=|>=|<=|>|<)\s*(.+)$/);
  if (compMatch && compMatch[1] && compMatch[2] && compMatch[3]) {
    const left = compMatch[1].trim();
    const op = compMatch[2];
    const right = compMatch[3].trim();

    const leftVal = left.startsWith(".") ? executeToken(data, left) : JSON.parse(left);
    const rightVal = right.startsWith(".") ? executeToken(data, right) : JSON.parse(right);

    switch (op) {
      case "==":
        return leftVal === rightVal;
      case "!=":
        return leftVal !== rightVal;
      case ">":
        return (leftVal as number) > (rightVal as number);
      case "<":
        return (leftVal as number) < (rightVal as number);
      case ">=":
        return (leftVal as number) >= (rightVal as number);
      case "<=":
        return (leftVal as number) <= (rightVal as number);
    }
  }

  // Simple field existence check (truthy check)
  if (expr.startsWith(".")) {
    const value = executeToken(data, expr);
    return value !== null && value !== false;
  }

  // has("key") function
  const hasMatch = expr.match(/^has\(["'](.+?)["']\)$/);
  if (hasMatch && hasMatch[1]) {
    if (data === null || typeof data !== "object" || Array.isArray(data)) {
      return false;
    }
    return hasMatch[1] in (data as Record<string, JsonValue>);
  }

  throw new Error(`Invalid condition: ${expr}`);
}

/**
 * Execute a query on JSON data
 *
 * @param data - JSON data to query
 * @param query - jq-like query string
 * @returns Query result
 */
export function executeQuery(data: JsonValue, query: string): QueryResult {
  const tokens = parseQuery(query);
  let values: JsonValue[] = [data];
  // Track whether we're in "iteration mode" (after .[] produces multiple values)
  let isIterating = false;

  for (const token of tokens) {
    const newValues: JsonValue[] = [];

    for (const value of values) {
      try {
        const tokenResult = executeToken(value, token);

        // Handle select specially - empty array means no match, skip this value
        if (token.startsWith("select(")) {
          if (Array.isArray(tokenResult) && tokenResult.length === 0) {
            // select didn't match, skip this value
            continue;
          }
          // select matched, push the value
          newValues.push(tokenResult as JsonValue);
          continue;
        }

        // Check if this token produces iteration (multiple values)
        if (token === ".[]" || token.match(/^\.([a-zA-Z_][a-zA-Z0-9_]*)\[\]$/)) {
          // .[] and .field[] produce iteration
          if (Array.isArray(tokenResult)) {
            newValues.push(...tokenResult);
            isIterating = true;
          } else {
            newValues.push(tokenResult);
          }
        } else if (Array.isArray(tokenResult) && isIterating &&
                   !token.includes("keys") && !token.includes("values") &&
                   !token.includes("map") && !token.match(/^\.\[\d+:\d*\]$/)) {
          // Iteration result that should expand (but not keys/values/map/slice which return arrays)
          newValues.push(...tokenResult);
        } else {
          newValues.push(tokenResult);
        }
      } catch (e) {
        // select() throws on errors, skip the item
        if (token.startsWith("select")) {
          continue;
        }
        throw e;
      }
    }

    values = newValues;
  }

  // Return IterationResult for iteration mode or empty result
  if (isIterating || values.length === 0) {
    return new IterationResult(values);
  }

  // Single value or single array result
  return values[0]!;
}
