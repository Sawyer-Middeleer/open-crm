/**
 * Context that flows between action steps
 * Note: Using string types instead of Id<> because lib files can't import from _generated
 */
export interface StepContext {
  workspaceId: string;
  actorId: string;
  actionExecutionId?: string;

  // The record that triggered the action
  record: {
    _id: string;
    _creationTime: number;
    data: Record<string, unknown>;
    [key: string]: unknown;
  };

  // Output from the previous step (if any)
  previousStepOutput?: Record<string, unknown>;

  // Accumulated variables from all previous steps
  variables: Record<string, unknown>;

  // Loop context (when inside a loop step)
  loopItem?: unknown;
  loopIndex?: number;

  // Nesting depth for loop recursion protection
  nestingDepth?: number;
}

/**
 * Get a value from the context by path
 * Supports: record.field, record._id, previous.field, variables.name, loopItem, loopIndex
 */
export function getContextValue(
  context: StepContext,
  path: string
): unknown {
  const parts = path.split(".");

  switch (parts[0]) {
    case "record": {
      if (parts[1] === "_id") {
        return context.record._id;
      }
      if (parts[1] === "_creationTime") {
        return context.record._creationTime;
      }
      // Access record.data fields
      const data = context.record.data as Record<string, unknown>;
      return parts.length > 1 ? getNestedValue(data, parts.slice(1)) : data;
    }

    case "previous": {
      if (!context.previousStepOutput) return undefined;
      return parts.length > 1
        ? getNestedValue(context.previousStepOutput, parts.slice(1))
        : context.previousStepOutput;
    }

    case "variables": {
      return parts.length > 1
        ? getNestedValue(context.variables, parts.slice(1))
        : context.variables;
    }

    case "loopItem": {
      if (parts.length === 1) return context.loopItem;
      if (typeof context.loopItem === "object" && context.loopItem !== null) {
        return getNestedValue(
          context.loopItem as Record<string, unknown>,
          parts.slice(1)
        );
      }
      return context.loopItem;
    }

    case "loopIndex": {
      return context.loopIndex;
    }

    default:
      return undefined;
  }
}

/**
 * Get nested value from an object using dot-notation path parts
 */
function getNestedValue(
  obj: Record<string, unknown>,
  parts: string[]
): unknown {
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

/**
 * Interpolate {{path}} placeholders in a string
 */
export function interpolateString(
  template: string,
  context: StepContext
): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (_, path: string) => {
    const value = getContextValue(context, path.trim());
    if (value === undefined || value === null) {
      return "";
    }
    return String(value);
  });
}

/**
 * Deep interpolate all string values in an object
 */
export function interpolateValue(
  value: unknown,
  context: StepContext
): unknown {
  if (typeof value === "string") {
    // Check if entire string is a single placeholder (preserve type)
    const match = value.match(/^\{\{([^}]+)\}\}$/);
    if (match) {
      return getContextValue(context, match[1].trim());
    }
    // Otherwise interpolate as string
    return interpolateString(value, context);
  }

  if (Array.isArray(value)) {
    return value.map((item) => interpolateValue(item, context));
  }

  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      result[key] = interpolateValue(val, context);
    }
    return result;
  }

  return value;
}

/**
 * Create initial step context from action execution args
 */
export function createInitialContext(args: {
  workspaceId: string;
  actorId: string;
  record: StepContext["record"];
  actionExecutionId?: string;
}): StepContext {
  return {
    workspaceId: args.workspaceId,
    actorId: args.actorId,
    actionExecutionId: args.actionExecutionId,
    record: args.record,
    previousStepOutput: undefined,
    variables: {},
    loopItem: undefined,
    loopIndex: undefined,
  };
}

/**
 * Update context after a step completes
 */
export function updateContextAfterStep(
  context: StepContext,
  stepId: string,
  output: Record<string, unknown>
): StepContext {
  return {
    ...context,
    previousStepOutput: output,
    variables: {
      ...context.variables,
      [stepId]: output,
    },
  };
}

/**
 * Create loop iteration context
 */
export function createLoopContext(
  parentContext: StepContext,
  item: unknown,
  index: number
): StepContext {
  return {
    ...parentContext,
    loopItem: item,
    loopIndex: index,
    nestingDepth: (parentContext.nestingDepth ?? 0) + 1,
  };
}
