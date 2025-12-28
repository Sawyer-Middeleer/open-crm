/**
 * Validation utilities for Convex functions
 */

// Maximum lengths for common fields
export const MAX_LENGTHS = {
  slug: 64,
  name: 128,
  description: 1000,
  email: 254,
  url: 2048,
} as const;

/**
 * Validate string length and throw descriptive error if exceeded
 */
export function validateStringLength(
  value: string | undefined | null,
  fieldName: string,
  maxLength: number
): void {
  if (value && value.length > maxLength) {
    throw new Error(
      `${fieldName} exceeds maximum length of ${maxLength} characters (got ${value.length})`
    );
  }
}

/**
 * Validate common fields on an object
 */
export function validateCommonFields(args: {
  slug?: string;
  name?: string;
  description?: string;
}): void {
  if (args.slug !== undefined) {
    validateStringLength(args.slug, "slug", MAX_LENGTHS.slug);
  }
  if (args.name !== undefined) {
    validateStringLength(args.name, "name", MAX_LENGTHS.name);
  }
  if (args.description !== undefined) {
    validateStringLength(args.description, "description", MAX_LENGTHS.description);
  }
}

/**
 * Validate cron expression format (5-field: minute hour day month weekday)
 *
 * Supports wildcards (*), ranges (1-5), lists (1,3,5), and steps (star/5, 1-10/2)
 */
export function validateCronSchedule(schedule: string): {
  valid: boolean;
  error?: string;
} {
  const parts = schedule.trim().split(/\s+/);

  if (parts.length !== 5) {
    return {
      valid: false,
      error:
        "Cron expression must have 5 fields (minute hour day month weekday)",
    };
  }

  const ranges = [
    { name: "minute", min: 0, max: 59 },
    { name: "hour", min: 0, max: 23 },
    { name: "day", min: 1, max: 31 },
    { name: "month", min: 1, max: 12 },
    { name: "weekday", min: 0, max: 7 }, // 0 and 7 both represent Sunday
  ];

  for (let i = 0; i < 5; i++) {
    const result = isValidCronField(parts[i], ranges[i]);
    if (!result.valid) {
      return {
        valid: false,
        error: `Invalid ${ranges[i].name} field: ${result.error}`,
      };
    }
  }

  return { valid: true };
}

function isValidCronField(
  field: string,
  range: { name: string; min: number; max: number }
): { valid: boolean; error?: string } {
  // Wildcard
  if (field === "*") {
    return { valid: true };
  }

  // Step values: */5, 1-10/2
  if (field.includes("/")) {
    const [base, step] = field.split("/");
    if (!/^\d+$/.test(step) || parseInt(step, 10) < 1) {
      return { valid: false, error: `invalid step value "${step}"` };
    }
    if (base === "*") {
      return { valid: true };
    }
    return isValidCronField(base, range);
  }

  // Lists: 1,3,5
  if (field.includes(",")) {
    const parts = field.split(",");
    for (const part of parts) {
      const result = isValidCronField(part, range);
      if (!result.valid) {
        return result;
      }
    }
    return { valid: true };
  }

  // Ranges: 1-5
  if (field.includes("-")) {
    const [startStr, endStr] = field.split("-");
    const start = parseInt(startStr, 10);
    const end = parseInt(endStr, 10);

    if (isNaN(start) || isNaN(end)) {
      return { valid: false, error: `invalid range "${field}"` };
    }
    if (start < range.min || end > range.max) {
      return {
        valid: false,
        error: `range out of bounds (${range.min}-${range.max})`,
      };
    }
    if (start > end) {
      return { valid: false, error: `start > end in range "${field}"` };
    }
    return { valid: true };
  }

  // Single value
  const num = parseInt(field, 10);
  if (isNaN(num)) {
    return { valid: false, error: `"${field}" is not a number` };
  }
  if (num < range.min || num > range.max) {
    return {
      valid: false,
      error: `${num} out of range (${range.min}-${range.max})`,
    };
  }

  return { valid: true };
}
