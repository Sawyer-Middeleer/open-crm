/**
 * Trigger evaluation helper for action lifecycle triggers.
 * Finds matching actions and schedules their execution asynchronously.
 */

import type { GenericMutationCtx, GenericDataModel } from "convex/server";
import type { Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";

export type TriggerType =
  | "onCreate"
  | "onUpdate"
  | "onDelete"
  | "onFieldChange"
  | "onListAdd"
  | "onListRemove";

interface TriggerParams {
  workspaceId: Id<"workspaces">;
  triggerType: TriggerType;
  objectTypeId?: Id<"objectTypes">;
  listId?: Id<"lists">;
  recordId: Id<"records">;
  actorId: Id<"workspaceMembers">;
  oldData?: Record<string, unknown>;
  newData?: Record<string, unknown>;
  changedFields?: string[];
}

interface ActionCondition {
  field: string;
  operator:
    | "equals"
    | "notEquals"
    | "contains"
    | "notContains"
    | "greaterThan"
    | "lessThan"
    | "isEmpty"
    | "isNotEmpty"
    | "in"
    | "notIn";
  value: unknown;
  logic?: "and" | "or";
}

interface Action {
  _id: Id<"actions">;
  workspaceId: Id<"workspaces">;
  trigger: {
    type: string;
    objectTypeId?: Id<"objectTypes">;
    listId?: Id<"lists">;
    watchedFields?: string[];
  };
  conditions?: ActionCondition[];
  isActive: boolean;
}

/**
 * Evaluate triggers for a lifecycle event and schedule matching action executions.
 * This function is async-safe and isolated - failures don't affect the calling mutation.
 */
export async function evaluateTriggers<DataModel extends GenericDataModel>(
  ctx: GenericMutationCtx<DataModel>,
  params: TriggerParams
): Promise<void> {
  try {
    // Find matching actions
    const actions = await findTriggeredActions(ctx, params);

    // Get the data to evaluate conditions against
    const dataForConditions = params.newData ?? params.oldData ?? {};

    // Schedule execution for each matching action
    for (const action of actions) {
      // Evaluate conditions if present
      if (action.conditions && action.conditions.length > 0) {
        if (!evaluateConditions(action.conditions, dataForConditions)) {
          continue; // Conditions not met, skip this action
        }
      }

      // Schedule async execution (isolated from this mutation)
      await ctx.scheduler.runAfter(
        0,
        internal.functions.actions.mutations.executeInternal,
        {
          workspaceId: params.workspaceId,
          actionId: action._id,
          recordId: params.recordId,
          actorId: params.actorId,
          triggeredBy: "automatic" as const,
        }
      );
    }
  } catch (error) {
    // Log error but don't throw - trigger failures should be isolated
    console.error(
      `[triggers] Error evaluating ${params.triggerType} triggers:`,
      error instanceof Error ? error.message : String(error)
    );
  }
}

/**
 * Find all active actions that match the trigger criteria
 */
async function findTriggeredActions<DataModel extends GenericDataModel>(
  ctx: GenericMutationCtx<DataModel>,
  params: TriggerParams
): Promise<Action[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = ctx.db as any;

  let actions: Action[];

  if (
    params.triggerType === "onListAdd" ||
    params.triggerType === "onListRemove"
  ) {
    // Query by list trigger
    actions = await db
      .query("actions")
      .withIndex("by_trigger_list", (q: any) =>
        q
          .eq("workspaceId", params.workspaceId)
          .eq("isActive", true)
          .eq("triggerType", params.triggerType)
          .eq("triggerListId", params.listId)
      )
      .collect();
  } else {
    // Query by object type trigger
    actions = await db
      .query("actions")
      .withIndex("by_trigger_object", (q: any) =>
        q
          .eq("workspaceId", params.workspaceId)
          .eq("isActive", true)
          .eq("triggerType", params.triggerType)
          .eq("triggerObjectTypeId", params.objectTypeId)
      )
      .collect();
  }

  // For onFieldChange, filter by watchedFields
  if (params.triggerType === "onFieldChange" && params.changedFields) {
    actions = actions.filter((action: Action) => {
      const watchedFields = action.trigger.watchedFields;
      if (!watchedFields || watchedFields.length === 0) {
        return true; // No specific fields to watch = watch all
      }
      // Check if any watched field was changed
      return watchedFields.some((field) => params.changedFields!.includes(field));
    });
  }

  return actions;
}

/**
 * Evaluate action conditions against record data
 */
function evaluateConditions(
  conditions: ActionCondition[],
  data: Record<string, unknown>
): boolean {
  if (conditions.length === 0) {
    return true;
  }

  // Default logic is "and" - all conditions must pass
  // If a condition has logic: "or", it changes the logic for subsequent conditions
  let result = true;
  let currentLogic: "and" | "or" = "and";

  for (const condition of conditions) {
    const fieldValue = data[condition.field];
    const conditionResult = evaluateSingleCondition(
      condition.operator,
      fieldValue,
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
 * Evaluate a single condition
 */
function evaluateSingleCondition(
  operator: ActionCondition["operator"],
  fieldValue: unknown,
  conditionValue: unknown
): boolean {
  switch (operator) {
    case "equals":
      return fieldValue === conditionValue;

    case "notEquals":
      return fieldValue !== conditionValue;

    case "contains":
      if (typeof fieldValue === "string" && typeof conditionValue === "string") {
        return fieldValue.includes(conditionValue);
      }
      if (Array.isArray(fieldValue)) {
        return fieldValue.includes(conditionValue);
      }
      return false;

    case "notContains":
      if (typeof fieldValue === "string" && typeof conditionValue === "string") {
        return !fieldValue.includes(conditionValue);
      }
      if (Array.isArray(fieldValue)) {
        return !fieldValue.includes(conditionValue);
      }
      return true;

    case "greaterThan":
      if (typeof fieldValue === "number" && typeof conditionValue === "number") {
        return fieldValue > conditionValue;
      }
      return false;

    case "lessThan":
      if (typeof fieldValue === "number" && typeof conditionValue === "number") {
        return fieldValue < conditionValue;
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
      if (Array.isArray(conditionValue)) {
        return conditionValue.includes(fieldValue);
      }
      return false;

    case "notIn":
      if (Array.isArray(conditionValue)) {
        return !conditionValue.includes(fieldValue);
      }
      return true;

    default:
      return false;
  }
}
