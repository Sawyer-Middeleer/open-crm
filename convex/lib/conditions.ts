/**
 * Consolidated condition evaluation utilities
 *
 * Used by:
 * - Action triggers (lib/triggers.ts)
 * - Action step conditions (functions/actions/mutations.ts)
 * - Scheduled action filters (functions/actions/scheduled.ts)
 */

export type ConditionOperator =
  | "equals"
  | "notEquals"
  | "contains"
  | "notContains"
  | "greaterThan"
  | "lessThan"
  | "greaterThanOrEquals"
  | "lessThanOrEquals"
  | "isEmpty"
  | "isNotEmpty"
  | "in"
  | "notIn";

export interface Condition {
  field: string;
  operator: ConditionOperator;
  value?: unknown;
  logic?: "and" | "or";
}

/**
 * Evaluate a single condition against a field value
 *
 * Note: `contains` and `notContains` are case-insensitive for strings
 */
export function evaluateCondition(
  fieldValue: unknown,
  operator: ConditionOperator | string,
  compareValue: unknown
): boolean {
  switch (operator) {
    case "equals":
      return fieldValue === compareValue;

    case "notEquals":
      return fieldValue !== compareValue;

    case "contains":
      // Case-insensitive for strings
      if (typeof fieldValue === "string" && typeof compareValue === "string") {
        return fieldValue.toLowerCase().includes(compareValue.toLowerCase());
      }
      // Array membership check
      if (Array.isArray(fieldValue)) {
        return fieldValue.includes(compareValue);
      }
      return false;

    case "notContains":
      // Case-insensitive for strings
      if (typeof fieldValue === "string" && typeof compareValue === "string") {
        return !fieldValue.toLowerCase().includes(compareValue.toLowerCase());
      }
      // Array membership check
      if (Array.isArray(fieldValue)) {
        return !fieldValue.includes(compareValue);
      }
      return true;

    case "greaterThan":
      if (typeof fieldValue === "number" && typeof compareValue === "number") {
        return fieldValue > compareValue;
      }
      return false;

    case "lessThan":
      if (typeof fieldValue === "number" && typeof compareValue === "number") {
        return fieldValue < compareValue;
      }
      return false;

    case "greaterThanOrEquals":
      if (typeof fieldValue === "number" && typeof compareValue === "number") {
        return fieldValue >= compareValue;
      }
      return false;

    case "lessThanOrEquals":
      if (typeof fieldValue === "number" && typeof compareValue === "number") {
        return fieldValue <= compareValue;
      }
      return false;

    case "isEmpty":
      return (
        fieldValue === null ||
        fieldValue === undefined ||
        fieldValue === "" ||
        (Array.isArray(fieldValue) && fieldValue.length === 0)
      );

    case "isNotEmpty":
      return !(
        fieldValue === null ||
        fieldValue === undefined ||
        fieldValue === "" ||
        (Array.isArray(fieldValue) && fieldValue.length === 0)
      );

    case "in":
      if (Array.isArray(compareValue)) {
        return compareValue.includes(fieldValue);
      }
      return false;

    case "notIn":
      if (Array.isArray(compareValue)) {
        return !compareValue.includes(fieldValue);
      }
      return true;

    default:
      return false;
  }
}

/**
 * Evaluate multiple conditions against a data object
 *
 * Supports and/or logic between conditions. Default is "and".
 * The `logic` field on each condition determines the logic for the NEXT condition.
 */
export function evaluateConditions(
  conditions: Condition[],
  data: Record<string, unknown>
): boolean {
  if (conditions.length === 0) {
    return true;
  }

  let result = true;
  let currentLogic: "and" | "or" = "and";

  for (const condition of conditions) {
    const fieldValue = data[condition.field];
    const conditionResult = evaluateCondition(
      fieldValue,
      condition.operator,
      condition.value
    );

    if (currentLogic === "and") {
      result = result && conditionResult;
    } else {
      result = result || conditionResult;
    }

    // Update logic for next condition
    currentLogic = condition.logic ?? "and";
  }

  return result;
}

/**
 * Evaluate conditions with AND logic only (all must pass)
 * Simplified version for filter conditions
 */
export function evaluateAllConditions(
  conditions: Array<{ field: string; operator: string; value?: unknown }>,
  data: Record<string, unknown>
): boolean {
  return conditions.every((condition) => {
    const fieldValue = data[condition.field];
    return evaluateCondition(fieldValue, condition.operator, condition.value);
  });
}
