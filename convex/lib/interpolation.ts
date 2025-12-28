/**
 * Shared interpolation utilities for template variable resolution
 */

/**
 * Get nested value from an object using dot-notation path
 * @param obj - The object to traverse
 * @param path - Either a dot-separated string ("a.b.c") or array of path parts (["a", "b", "c"])
 */
export function getNestedValue(
  obj: unknown,
  path: string | string[]
): unknown {
  const parts = typeof path === "string" ? path.split(".") : path;
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}
