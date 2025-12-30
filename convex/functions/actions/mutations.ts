import { mutation, internalMutation } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { v } from "convex/values";
import type { Id } from "../../_generated/dataModel";
import { createAuditLog } from "../../lib/audit";
import { assertActorInWorkspace } from "../../lib/auth";
import { evaluateCondition } from "../../lib/conditions";
import { validateUrlForFetch } from "../../lib/urlValidation";
import { validateCronSchedule, validateCommonFields } from "../../lib/validation";
import type { StepContext } from "../../lib/actionContext";
import {
  createInitialContext,
  updateContextAfterStep,
  createLoopContext,
  interpolateValue,
} from "../../lib/actionContext";

// ============================================================================
// TYPES
// ============================================================================

interface Step {
  id: string;
  type: string;
  name?: string;
  config: Record<string, unknown>;
  thenSteps?: Step[];
  elseSteps?: Step[];
  steps?: Step[]; // for loop
}

interface StepResult {
  success: boolean;
  startedAt: number;
  completedAt: number;
  output?: unknown;
  error?: string;
}

interface StepResultRecord {
  stepId: string;
  status: "completed" | "failed";
  startedAt: number;
  completedAt: number;
  output?: unknown;
  error?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MutationContext = any; // Using any for ctx since extracting exact type is complex

interface ActionExecutionResult {
  executionId: Id<"actionExecutions">;
  status: "completed" | "failed";
  stepResults: StepResultRecord[];
}

// ============================================================================
// ACTION EXECUTION
// ============================================================================

export const execute = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    actionSlug: v.string(),
    recordId: v.id("records"),
    actorId: v.id("workspaceMembers"),
  },
  handler: async (ctx, args): Promise<ActionExecutionResult> => {
    // Verify the actor has access to this workspace
    await assertActorInWorkspace(ctx, args.workspaceId, args.actorId);

    // Resolve action slug to ID
    const action = await ctx.db
      .query("actions")
      .withIndex("by_workspace_slug", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("slug", args.actionSlug)
      )
      .first();

    if (!action) {
      throw new Error(`Action '${args.actionSlug}' not found`);
    }

    // Delegate to internal execution
    return ctx.runMutation(internal.functions.actions.mutations.executeInternal, {
      workspaceId: args.workspaceId,
      actionId: action._id,
      recordId: args.recordId,
      actorId: args.actorId,
      triggeredBy: "manual",
    });
  },
});

// ============================================================================
// INTERNAL ACTION EXECUTION (shared by public execute and webhook triggers)
// ============================================================================

export const executeInternal = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    actionId: v.id("actions"),
    recordId: v.id("records"),
    actorId: v.id("workspaceMembers"),
    triggeredBy: v.union(
      v.literal("manual"),
      v.literal("automatic"),
      v.literal("scheduled")
    ),
  },
  handler: async (ctx, args) => {
    // Get the action
    const action = await ctx.db.get(args.actionId);
    if (!action) {
      throw new Error("Action not found");
    }
    if (!action.isActive) {
      throw new Error("Action is not active");
    }

    // Get the record
    const record = await ctx.db.get(args.recordId);
    if (!record || record.workspaceId !== args.workspaceId) {
      throw new Error("Record not found");
    }

    const now = Date.now();

    // Create execution record
    const executionId = await ctx.db.insert("actionExecutions", {
      workspaceId: args.workspaceId,
      actionId: args.actionId,
      triggeredBy: args.triggeredBy,
      triggerRecordId: args.recordId,
      status: "running",
      startedAt: now,
      stepResults: [],
      initiatorId: args.actorId,
    });

    try {
      // Initialize step context
      let stepContext = createInitialContext({
        workspaceId: args.workspaceId,
        actorId: args.actorId,
        record,
        actionExecutionId: executionId,
      });

      // Execute each step
      const stepResults: StepResultRecord[] = [];

      for (const step of action.steps) {
        const stepResult = await executeStep(ctx, step, stepContext);

        stepResults.push({
          stepId: step.id,
          status: stepResult.success ? "completed" : "failed",
          startedAt: stepResult.startedAt,
          completedAt: stepResult.completedAt,
          output: stepResult.output,
          error: stepResult.error,
        });

        if (!stepResult.success) {
          break;
        }

        // Update context for next step
        stepContext = updateContextAfterStep(
          stepContext,
          step.id,
          (stepResult.output as Record<string, unknown>) ?? {}
        );

        // Re-fetch record if it was modified
        if (
          ["updateField", "clearField", "copyField", "transformField"].includes(
            step.type
          )
        ) {
          const updatedRecord = await ctx.db.get(args.recordId);
          if (updatedRecord) {
            stepContext = { ...stepContext, record: updatedRecord };
          }
        }
      }

      const allSucceeded = stepResults.every((r) => r.status === "completed");

      await ctx.db.patch(executionId, {
        status: allSucceeded ? "completed" : "failed",
        completedAt: Date.now(),
        stepResults,
        error: allSucceeded
          ? undefined
          : stepResults.find((r) => r.error)?.error,
      });

      await createAuditLog(ctx, {
        workspaceId: args.workspaceId,
        entityType: "record",
        entityId: args.recordId,
        objectTypeId: record.objectTypeId,
        action: "action_executed",
        changes: [],
        actorId: args.actorId,
        actorType: "action",
        metadata: {
          actionId: action._id,
          actionExecutionId: executionId,
        },
      });

      return {
        executionId,
        status: (allSucceeded ? "completed" : "failed") as "completed" | "failed",
        stepResults,
      };
    } catch (error) {
      await ctx.db.patch(executionId, {
        status: "failed",
        completedAt: Date.now(),
        error: error instanceof Error ? error.message : "Unknown error",
      });

      throw error;
    }
  },
});

// ============================================================================
// STEP EXECUTION
// ============================================================================

async function executeStep(
  ctx: MutationContext,
  step: Step,
  context: StepContext
): Promise<StepResult> {
  const startedAt = Date.now();

  try {
    // Interpolate config values
    const config = interpolateValue(step.config, context) as Record<string, unknown>;

    switch (step.type) {
      // ========================================
      // FIELD OPERATIONS
      // ========================================
      case "updateField": {
        const { field, value } = config as { field: string; value: unknown };
        const newData = { ...context.record.data, [field]: value };

        await ctx.db.patch(context.record._id, {
          data: newData,
          updatedAt: Date.now(),
        });

        return success(startedAt, { field, value, updated: true });
      }

      case "clearField": {
        const { field } = config as { field: string };
        const newData = { ...context.record.data };
        delete (newData as Record<string, unknown>)[field];

        await ctx.db.patch(context.record._id, {
          data: newData,
          updatedAt: Date.now(),
        });

        return success(startedAt, { field, cleared: true });
      }

      case "copyField": {
        const { sourceField, targetField } = config as {
          sourceField: string;
          targetField: string;
        };
        const data = context.record.data as Record<string, unknown>;
        const value = data[sourceField];
        const newData = { ...data, [targetField]: value };

        await ctx.db.patch(context.record._id, {
          data: newData,
          updatedAt: Date.now(),
        });

        return success(startedAt, { sourceField, targetField, value, copied: true });
      }

      case "transformField": {
        const { field, transform, amount } = config as {
          field: string;
          transform: string;
          amount?: number;
        };
        const data = context.record.data as Record<string, unknown>;
        const value = data[field];
        let newValue: unknown = value;

        switch (transform) {
          case "uppercase":
            newValue = typeof value === "string" ? value.toUpperCase() : value;
            break;
          case "lowercase":
            newValue = typeof value === "string" ? value.toLowerCase() : value;
            break;
          case "trim":
            newValue = typeof value === "string" ? value.trim() : value;
            break;
          case "round":
            newValue = typeof value === "number" ? Math.round(value) : value;
            break;
          case "increment":
            newValue = typeof value === "number" ? value + (amount ?? 1) : value;
            break;
          case "decrement":
            newValue = typeof value === "number" ? value - (amount ?? 1) : value;
            break;
        }

        const newData = { ...data, [field]: newValue };
        await ctx.db.patch(context.record._id, {
          data: newData,
          updatedAt: Date.now(),
        });

        return success(startedAt, { field, transform, oldValue: value, newValue });
      }

      case "updateRelatedRecord": {
        const { referenceField, field, value } = config as {
          referenceField: string;
          field: string;
          value: unknown;
        };

        // Get the referenced record ID from the triggered record
        const recordData = context.record.data as Record<string, unknown>;
        const relatedId = recordData[referenceField];

        if (!relatedId) {
          return failure(
            startedAt,
            `Reference field '${referenceField}' is empty - no related record to update`
          );
        }

        // Validate it looks like a Convex ID
        if (typeof relatedId !== "string") {
          return failure(
            startedAt,
            `Reference field '${referenceField}' is not a valid record ID`
          );
        }

        // Fetch the related record
        const relatedRecord = await ctx.db.get(relatedId as Id<"records">);
        if (!relatedRecord) {
          return failure(
            startedAt,
            `Related record '${relatedId}' not found`
          );
        }

        // Verify it belongs to the same workspace
        if (relatedRecord.workspaceId !== context.workspaceId) {
          return failure(
            startedAt,
            `Related record belongs to a different workspace`
          );
        }

        // Update the related record
        const newData = { ...relatedRecord.data, [field]: value };
        await ctx.db.patch(relatedId as Id<"records">, {
          data: newData,
          updatedAt: Date.now(),
        });

        return success(startedAt, {
          referenceField,
          relatedRecordId: relatedId,
          field,
          value,
          updated: true,
        });
      }

      // ========================================
      // RECORD OPERATIONS
      // ========================================
      case "createRecord": {
        const { objectType, data } = config as {
          objectType: string;
          data: Record<string, unknown>;
        };

        // Resolve object type slug
        const objectTypeDoc = await ctx.db
          .query("objectTypes")
          .withIndex("by_workspace_slug", (q: any) =>
            q.eq("workspaceId", context.workspaceId).eq("slug", objectType)
          )
          .first();

        if (!objectTypeDoc) {
          return failure(startedAt, `Object type '${objectType}' not found`);
        }

        // Compute display name
        let displayName: string | undefined;
        if (objectTypeDoc.displayConfig.primaryAttribute) {
          displayName = String(data[objectTypeDoc.displayConfig.primaryAttribute] ?? "");
        }

        const now = Date.now();
        const recordId = await ctx.db.insert("records", {
          workspaceId: context.workspaceId,
          objectTypeId: objectTypeDoc._id,
          data,
          displayName,
          createdBy: context.actorId,
          createdAt: now,
          updatedAt: now,
        });

        await createAuditLog(ctx, {
          workspaceId: context.workspaceId,
          entityType: "record",
          entityId: recordId,
          objectTypeId: objectTypeDoc._id,
          action: "create",
          changes: Object.entries(data).map(([field, value]) => ({ field, after: value })),
          afterSnapshot: data,
          actorId: context.actorId,
          actorType: "action",
          metadata: { source: "action" },
        });

        return success(startedAt, { createdRecordId: recordId, objectType, data });
      }

      case "deleteRecord": {
        const { recordId, useTriggeredRecord } = config as {
          recordId?: string;
          useTriggeredRecord?: boolean;
        };

        const targetId = (useTriggeredRecord
          ? context.record._id
          : recordId) as string;

        if (!targetId) {
          return failure(startedAt, "No record ID specified for deletion");
        }

        const targetRecord = await ctx.db.get(targetId);
        if (!targetRecord || targetRecord.workspaceId !== context.workspaceId) {
          return failure(startedAt, "Record not found");
        }

        // Create audit log before deletion
        await createAuditLog(ctx, {
          workspaceId: context.workspaceId,
          entityType: "record",
          entityId: targetId,
          objectTypeId: targetRecord.objectTypeId,
          action: "delete",
          changes: [],
          beforeSnapshot: targetRecord.data,
          actorId: context.actorId,
          actorType: "action",
          metadata: { source: "action" },
        });

        // Delete list entries
        const listEntries = await ctx.db
          .query("listEntries")
          .withIndex("by_record", (q: any) => q.eq("recordId", targetId))
          .collect();

        for (const entry of listEntries) {
          await ctx.db.delete(entry._id);
        }

        await ctx.db.delete(targetId);

        return success(startedAt, { deletedRecordId: targetId });
      }

      case "archiveRecord": {
        const { recordId, useTriggeredRecord } = config as {
          recordId?: string;
          useTriggeredRecord?: boolean;
        };

        const targetId = (useTriggeredRecord
          ? context.record._id
          : recordId) as string;

        if (!targetId) {
          return failure(startedAt, "No record ID specified for archiving");
        }

        const targetRecord = await ctx.db.get(targetId);
        if (!targetRecord || targetRecord.workspaceId !== context.workspaceId) {
          return failure(startedAt, "Record not found");
        }

        if (targetRecord.archivedAt) {
          return failure(startedAt, "Record is already archived");
        }

        const now = Date.now();

        await ctx.db.patch(targetId, {
          archivedAt: now,
          updatedAt: now,
        });

        await createAuditLog(ctx, {
          workspaceId: context.workspaceId,
          entityType: "record",
          entityId: targetId,
          objectTypeId: targetRecord.objectTypeId,
          action: "archive",
          changes: [{ field: "archivedAt", before: undefined, after: now }],
          beforeSnapshot: targetRecord.data,
          afterSnapshot: targetRecord.data,
          actorId: context.actorId,
          actorType: "action",
          metadata: { source: "action" },
        });

        return success(startedAt, { archivedRecordId: targetId });
      }

      case "restoreRecord": {
        const { recordId, useTriggeredRecord } = config as {
          recordId?: string;
          useTriggeredRecord?: boolean;
        };

        const targetId = (useTriggeredRecord
          ? context.record._id
          : recordId) as string;

        if (!targetId) {
          return failure(startedAt, "No record ID specified for restoring");
        }

        const targetRecord = await ctx.db.get(targetId);
        if (!targetRecord || targetRecord.workspaceId !== context.workspaceId) {
          return failure(startedAt, "Record not found");
        }

        if (!targetRecord.archivedAt) {
          return failure(startedAt, "Record is not archived");
        }

        const now = Date.now();

        await ctx.db.patch(targetId, {
          archivedAt: undefined,
          updatedAt: now,
        });

        await createAuditLog(ctx, {
          workspaceId: context.workspaceId,
          entityType: "record",
          entityId: targetId,
          objectTypeId: targetRecord.objectTypeId,
          action: "restore",
          changes: [{ field: "archivedAt", before: targetRecord.archivedAt, after: undefined }],
          beforeSnapshot: targetRecord.data,
          afterSnapshot: targetRecord.data,
          actorId: context.actorId,
          actorType: "action",
          metadata: { source: "action" },
        });

        return success(startedAt, { restoredRecordId: targetId });
      }

      // ========================================
      // LIST OPERATIONS
      // ========================================
      case "addToList": {
        const { list, recordId, parentRecordId, data } = config as {
          list: string;
          recordId?: string;
          parentRecordId?: string;
          data?: Record<string, unknown>;
        };

        // Resolve list slug
        const listDoc = await ctx.db
          .query("lists")
          .withIndex("by_workspace_slug", (q: any) =>
            q.eq("workspaceId", context.workspaceId).eq("slug", list)
          )
          .first();

        if (!listDoc) {
          return failure(startedAt, `List '${list}' not found`);
        }

        const targetRecordId = (recordId ?? context.record._id) as string;

        const now = Date.now();
        const entryId = await ctx.db.insert("listEntries", {
          workspaceId: context.workspaceId as never,
          listId: listDoc._id,
          recordId: targetRecordId as never,
          parentRecordId: parentRecordId as never,
          addedBy: context.actorId as never,
          data: data ?? {},
          createdAt: now,
          updatedAt: now,
        });

        return success(startedAt, { entryId, list, recordId: targetRecordId });
      }

      case "removeFromList": {
        const { list, recordId, parentRecordId } = config as {
          list: string;
          recordId?: string;
          parentRecordId?: string;
        };

        const listDoc = await ctx.db
          .query("lists")
          .withIndex("by_workspace_slug", (q: any) =>
            q.eq("workspaceId", context.workspaceId).eq("slug", list)
          )
          .first();

        if (!listDoc) {
          return failure(startedAt, `List '${list}' not found`);
        }

        const targetRecordId = (recordId ?? context.record._id) as string;

        // Find and delete the entry
        let entries = await ctx.db
          .query("listEntries")
          .withIndex("by_list_record", (q: any) =>
            q.eq("listId", listDoc._id).eq("recordId", targetRecordId as never)
          )
          .collect();

        if (parentRecordId) {
          entries = entries.filter(
            (e: any) => e.parentRecordId === parentRecordId
          );
        }

        for (const entry of entries) {
          await ctx.db.delete(entry._id);
        }

        return success(startedAt, {
          list,
          recordId: targetRecordId,
          removedCount: entries.length,
        });
      }

      case "updateListEntry": {
        const { list, recordId, parentRecordId, data } = config as {
          list: string;
          recordId?: string;
          parentRecordId?: string;
          data: Record<string, unknown>;
        };

        const listDoc = await ctx.db
          .query("lists")
          .withIndex("by_workspace_slug", (q: any) =>
            q.eq("workspaceId", context.workspaceId).eq("slug", list)
          )
          .first();

        if (!listDoc) {
          return failure(startedAt, `List '${list}' not found`);
        }

        const targetRecordId = (recordId ?? context.record._id) as string;

        let entries = await ctx.db
          .query("listEntries")
          .withIndex("by_list_record", (q: any) =>
            q.eq("listId", listDoc._id).eq("recordId", targetRecordId as never)
          )
          .collect();

        if (parentRecordId) {
          entries = entries.filter(
            (e: any) => e.parentRecordId === parentRecordId
          );
        }

        for (const entry of entries) {
          await ctx.db.patch(entry._id, {
            data: { ...entry.data, ...data },
            updatedAt: Date.now(),
          });
        }

        return success(startedAt, {
          list,
          recordId: targetRecordId,
          updatedCount: entries.length,
        });
      }

      // ========================================
      // CONTROL FLOW
      // ========================================
      case "condition": {
        // Check nesting depth to prevent stack overflow
        const MAX_NESTING_DEPTH = 5;
        const currentDepth = context.nestingDepth ?? 0;

        if (currentDepth >= MAX_NESTING_DEPTH) {
          return failure(
            startedAt,
            `Maximum condition nesting depth exceeded (${MAX_NESTING_DEPTH})`
          );
        }

        const { conditions, logic } = config as {
          conditions: Array<{
            field: string;
            operator: string;
            value: unknown;
          }>;
          logic?: "and" | "or";
        };

        const recordData = context.record.data as Record<string, unknown>;
        const results = conditions.map((cond) =>
          evaluateCondition(recordData[cond.field], cond.operator, cond.value)
        );

        const passed =
          logic === "or"
            ? results.some((r) => r)
            : results.every((r) => r);

        // Execute then/else steps
        const stepsToRun = passed ? step.thenSteps : step.elseSteps;
        const nestedResults: StepResultRecord[] = [];

        if (stepsToRun && stepsToRun.length > 0) {
          // Increment nesting depth for nested steps
          let nestedContext = {
            ...context,
            nestingDepth: currentDepth + 1,
          };

          for (const nestedStep of stepsToRun) {
            const result = await executeStep(ctx, nestedStep, nestedContext);
            nestedResults.push({
              stepId: nestedStep.id,
              status: result.success ? "completed" : "failed",
              startedAt: result.startedAt,
              completedAt: result.completedAt,
              output: result.output,
              error: result.error,
            });

            if (!result.success) break;

            nestedContext = {
              ...updateContextAfterStep(
                nestedContext,
                nestedStep.id,
                (result.output as Record<string, unknown>) ?? {}
              ),
              nestingDepth: currentDepth + 1,
            };
          }
        }

        return success(startedAt, {
          conditionPassed: passed,
          branch: passed ? "then" : "else",
          nestedResults,
        });
      }

      case "loop": {
        // Check nesting depth to prevent stack overflow
        const MAX_NESTING_DEPTH = 5;
        const currentDepth = context.nestingDepth ?? 0;

        if (currentDepth >= MAX_NESTING_DEPTH) {
          return failure(
            startedAt,
            `Maximum loop nesting depth exceeded (${MAX_NESTING_DEPTH})`
          );
        }

        const { source, objectType, filters, items, field, maxIterations } =
          config as {
            source: "records" | "array" | "field";
            objectType?: string;
            filters?: Array<{ field: string; operator: string; value: unknown }>;
            items?: unknown[];
            field?: string;
            maxIterations?: number;
          };

        const max = maxIterations ?? 100;
        let loopItems: unknown[] = [];

        // Gather items based on source
        switch (source) {
          case "array":
            loopItems = items ?? [];
            break;

          case "field": {
            const recordData = context.record.data as Record<string, unknown>;
            const fieldValue = field ? recordData[field] : undefined;
            loopItems = Array.isArray(fieldValue) ? fieldValue : [];
            break;
          }

          case "records": {
            if (!objectType) {
              return failure(startedAt, "objectType required for records source");
            }

            const objType = await ctx.db
              .query("objectTypes")
              .withIndex("by_workspace_slug", (q: any) =>
                q.eq("workspaceId", context.workspaceId).eq("slug", objectType)
              )
              .first();

            if (!objType) {
              return failure(startedAt, `Object type '${objectType}' not found`);
            }

            let records = await ctx.db
              .query("records")
              .withIndex("by_workspace_object_type", (q: any) =>
                q
                  .eq("workspaceId", context.workspaceId)
                  .eq("objectTypeId", objType._id)
              )
              .collect();

            // Apply filters
            if (filters && filters.length > 0) {
              records = records.filter((r: any) => {
                const data = r.data as Record<string, unknown>;
                return filters.every((f) =>
                  evaluateCondition(data[f.field], f.operator, f.value)
                );
              });
            }

            loopItems = records;
            break;
          }
        }

        // Limit iterations and track if truncated
        const originalCount = loopItems.length;
        const wasTruncated = originalCount > max;
        loopItems = loopItems.slice(0, max);

        // Execute loop
        const loopResults: StepResultRecord[] = [];
        let loopContext = context;

        for (let i = 0; i < loopItems.length; i++) {
          const iterContext = createLoopContext(loopContext, loopItems[i], i);

          for (const loopStep of step.steps ?? []) {
            const result = await executeStep(ctx, loopStep, iterContext);
            loopResults.push({
              stepId: `${loopStep.id}[${i}]`,
              status: result.success ? "completed" : "failed",
              startedAt: result.startedAt,
              completedAt: result.completedAt,
              output: result.output,
              error: result.error,
            });

            if (!result.success) {
              return success(startedAt, {
                iterations: i + 1,
                totalItems: originalCount,
                itemsProcessed: i + 1,
                itemsSkipped: wasTruncated ? originalCount - max : 0,
                loopResults,
                stoppedEarly: true,
                truncated: wasTruncated,
              });
            }
          }
        }

        return success(startedAt, {
          iterations: loopItems.length,
          totalItems: originalCount,
          itemsProcessed: loopItems.length,
          itemsSkipped: wasTruncated ? originalCount - max : 0,
          loopResults,
          truncated: wasTruncated,
        });
      }

      // ========================================
      // EXTERNAL
      // ========================================
      case "sendWebhook": {
        // Schedule HTTP action to send the webhook
        const { url, method, headers, body, templateSlug, variables, authConfig } = config as {
          url?: string;
          method?: string;
          headers?: Record<string, string>;
          body?: unknown;
          templateSlug?: string;
          variables?: Record<string, unknown>;
          authConfig?: {
            type: string;
            tokenEnvVar?: string;
            usernameEnvVar?: string;
            passwordEnvVar?: string;
            headerName?: string;
            keyEnvVar?: string;
          };
        };

        // If URL is directly provided (not using template), validate it now
        // Template-based URLs are validated at runtime in sendFromTemplate after interpolation
        if (url && !templateSlug) {
          const urlValidation = validateUrlForFetch(url);
          if (!urlValidation.valid) {
            return failure(startedAt, `SSRF protection: ${urlValidation.error}`);
          }
        }

        // Schedule the HTTP action (runs immediately after mutation completes)
        await ctx.scheduler.runAfter(
          0,
          internal.functions.integrations.httpActions.sendHttpRequest,
          {
            workspaceId: context.workspaceId,
            // Direct mode params
            method: method,
            url: url,
            headers,
            body,
            authConfig,
            // Template mode params
            templateSlug,
            variables,
            // Logging context
            actionExecutionId: context.actionExecutionId,
            stepId: step.id,
          }
        );

        return success(startedAt, {
          scheduled: true,
          url: url ?? undefined,
          method: method ?? "POST",
          templateSlug,
          message: templateSlug
            ? `HTTP request scheduled using template '${templateSlug}'`
            : "HTTP request scheduled for execution",
        });
      }

      default:
        return failure(startedAt, `Unknown step type: ${step.type}`);
    }
  } catch (error) {
    return failure(
      startedAt,
      error instanceof Error ? error.message : "Unknown error"
    );
  }
}

// ============================================================================
// HELPERS
// ============================================================================

function success(startedAt: number, output: unknown): StepResult {
  return {
    success: true,
    startedAt,
    completedAt: Date.now(),
    output,
  };
}

function failure(startedAt: number, error: string): StepResult {
  return {
    success: false,
    startedAt,
    completedAt: Date.now(),
    error,
  };
}


// ============================================================================
// ACTION CREATION
// ============================================================================

export const create = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    name: v.string(),
    slug: v.string(),
    description: v.optional(v.string()),
    trigger: v.object({
      type: v.union(
        v.literal("manual"),
        v.literal("onCreate"),
        v.literal("onUpdate"),
        v.literal("onDelete"),
        v.literal("onFieldChange"),
        v.literal("onListAdd"),
        v.literal("onListRemove"),
        v.literal("scheduled")
      ),
      objectTypeId: v.optional(v.id("objectTypes")),
      listId: v.optional(v.id("lists")),
      watchedFields: v.optional(v.array(v.string())),
      schedule: v.optional(v.string()),
    }),
    conditions: v.optional(
      v.array(
        v.object({
          field: v.string(),
          operator: v.string(),
          value: v.any(),
          logic: v.optional(v.union(v.literal("and"), v.literal("or"))),
        })
      )
    ),
    steps: v.array(
      v.object({
        id: v.string(),
        type: v.string(),
        name: v.optional(v.string()),
        config: v.any(),
        thenSteps: v.optional(v.array(v.any())),
        elseSteps: v.optional(v.array(v.any())),
        steps: v.optional(v.array(v.any())),
      })
    ),
    isActive: v.optional(v.boolean()),
    actorId: v.id("workspaceMembers"),
  },
  handler: async (ctx, args) => {
    // Validate input lengths
    validateCommonFields(args);

    // Verify the actor has access to this workspace
    await assertActorInWorkspace(ctx, args.workspaceId, args.actorId);

    const now = Date.now();

    // Insert first, then check for duplicates (prevents TOCTOU race condition)
    const actionId = await ctx.db.insert("actions", {
      workspaceId: args.workspaceId,
      name: args.name,
      slug: args.slug,
      description: args.description,
      trigger: args.trigger,
      conditions: args.conditions as never,
      steps: args.steps as never,
      isActive: args.isActive ?? true,
      isSystem: false,
      createdAt: now,
      updatedAt: now,
      // Denormalized trigger fields for efficient indexing
      triggerType: args.trigger.type,
      triggerObjectTypeId: args.trigger.objectTypeId,
      triggerListId: args.trigger.listId,
    });

    // Check for duplicate slugs after insert
    const duplicates = await ctx.db
      .query("actions")
      .withIndex("by_workspace_slug", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("slug", args.slug)
      )
      .collect();

    if (duplicates.length > 1) {
      const sorted = duplicates.sort((a, b) => a._creationTime - b._creationTime);
      const winner = sorted[0];

      if (winner._id !== actionId) {
        await ctx.db.delete(actionId);
        throw new Error(`Action with slug '${args.slug}' already exists`);
      }
      for (const dup of sorted.slice(1)) {
        await ctx.db.delete(dup._id);
      }
    }

    await createAuditLog(ctx, {
      workspaceId: args.workspaceId,
      entityType: "action",
      entityId: actionId,
      action: "create",
      changes: [
        { field: "name", after: args.name },
        { field: "slug", after: args.slug },
      ],
      actorId: args.actorId,
      actorType: "user",
    });

    const action = await ctx.db.get(actionId);

    return { actionId, action };
  },
});

// ============================================================================
// ACTION CREATION WITH SLUG RESOLUTION
// ============================================================================

export const createWithSlugs = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    name: v.string(),
    slug: v.string(),
    description: v.optional(v.string()),
    trigger: v.object({
      type: v.union(
        v.literal("manual"),
        v.literal("onCreate"),
        v.literal("onUpdate"),
        v.literal("onDelete"),
        v.literal("onFieldChange"),
        v.literal("onListAdd"),
        v.literal("onListRemove"),
        v.literal("scheduled")
      ),
      objectType: v.optional(v.string()), // slug
      list: v.optional(v.string()), // slug
      watchedFields: v.optional(v.array(v.string())),
      schedule: v.optional(v.string()),
      filterConditions: v.optional(
        v.array(
          v.object({
            field: v.string(),
            operator: v.union(
              v.literal("equals"),
              v.literal("notEquals"),
              v.literal("contains"),
              v.literal("greaterThan"),
              v.literal("lessThan"),
              v.literal("isEmpty"),
              v.literal("isNotEmpty")
            ),
            value: v.optional(v.any()),
          })
        )
      ),
    }),
    conditions: v.optional(
      v.array(
        v.object({
          field: v.string(),
          operator: v.string(),
          value: v.any(),
          logic: v.optional(v.union(v.literal("and"), v.literal("or"))),
        })
      )
    ),
    steps: v.array(
      v.object({
        id: v.string(),
        type: v.string(),
        name: v.optional(v.string()),
        config: v.any(),
        thenSteps: v.optional(v.array(v.any())),
        elseSteps: v.optional(v.array(v.any())),
        steps: v.optional(v.array(v.any())),
      })
    ),
    isActive: v.optional(v.boolean()),
    actorId: v.id("workspaceMembers"),
  },
  handler: async (ctx, args) => {
    // Verify the actor has access to this workspace
    await assertActorInWorkspace(ctx, args.workspaceId, args.actorId);

    // Resolve object type slug to ID
    let objectTypeId: string | undefined;
    if (args.trigger.objectType) {
      const objectType = await ctx.db
        .query("objectTypes")
        .withIndex("by_workspace_slug", (q) =>
          q
            .eq("workspaceId", args.workspaceId)
            .eq("slug", args.trigger.objectType!)
        )
        .first();

      if (!objectType) {
        throw new Error(
          `Object type '${args.trigger.objectType}' not found`
        );
      }
      objectTypeId = objectType._id;
    }

    // Resolve list slug to ID
    let listId: string | undefined;
    if (args.trigger.list) {
      const list = await ctx.db
        .query("lists")
        .withIndex("by_workspace_slug", (q) =>
          q.eq("workspaceId", args.workspaceId).eq("slug", args.trigger.list!)
        )
        .first();

      if (!list) {
        throw new Error(`List '${args.trigger.list}' not found`);
      }
      listId = list._id;
    }

    // Check for duplicate slug
    const existing = await ctx.db
      .query("actions")
      .withIndex("by_workspace_slug", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("slug", args.slug)
      )
      .first();

    if (existing) {
      throw new Error(`Action with slug '${args.slug}' already exists`);
    }

    // Validate cron schedule for scheduled triggers
    if (args.trigger.type === "scheduled") {
      if (!args.trigger.schedule) {
        throw new Error("Schedule is required for scheduled trigger type");
      }
      const cronResult = validateCronSchedule(args.trigger.schedule);
      if (!cronResult.valid) {
        throw new Error(`Invalid cron schedule: ${cronResult.error}`);
      }
    }

    const now = Date.now();

    const actionId = await ctx.db.insert("actions", {
      workspaceId: args.workspaceId,
      name: args.name,
      slug: args.slug,
      description: args.description,
      trigger: {
        type: args.trigger.type,
        objectTypeId: objectTypeId as never,
        listId: listId as never,
        watchedFields: args.trigger.watchedFields,
        schedule: args.trigger.schedule,
        filterConditions: args.trigger.filterConditions as never,
      },
      conditions: args.conditions as never,
      steps: args.steps as never,
      isActive: args.isActive ?? true,
      isSystem: false,
      createdAt: now,
      updatedAt: now,
      // Denormalized trigger fields for efficient indexing
      triggerType: args.trigger.type,
      triggerObjectTypeId: objectTypeId as never,
      triggerListId: listId as never,
    });

    await createAuditLog(ctx, {
      workspaceId: args.workspaceId,
      entityType: "action",
      entityId: actionId,
      action: "create",
      changes: [
        { field: "name", after: args.name },
        { field: "slug", after: args.slug },
      ],
      actorId: args.actorId,
      actorType: "user",
    });

    const action = await ctx.db.get(actionId);

    return { actionId, action };
  },
});

// ============================================================================
// ACTION DELETION
// ============================================================================

export const remove = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    actionId: v.id("actions"),
    actorId: v.id("workspaceMembers"),
  },
  handler: async (ctx, args) => {
    // Verify the actor has access to this workspace
    await assertActorInWorkspace(ctx, args.workspaceId, args.actorId);

    // Fetch action
    const action = await ctx.db.get(args.actionId);
    if (!action) {
      throw new Error("Action not found");
    }
    if (action.workspaceId !== args.workspaceId) {
      throw new Error("Action not found in workspace");
    }

    // Prevent system action deletion
    if (action.isSystem) {
      throw new Error("Cannot delete system actions");
    }

    // Check for active executions
    const activeExecution = await ctx.db
      .query("actionExecutions")
      .withIndex("by_action", (q) => q.eq("actionId", args.actionId))
      .filter((q) =>
        q.or(
          q.eq(q.field("status"), "pending"),
          q.eq(q.field("status"), "running")
        )
      )
      .first();

    if (activeExecution) {
      throw new Error("Cannot delete action with active executions");
    }

    // Check for webhook references
    const webhooks = await ctx.db
      .query("incomingWebhooks")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();

    const referencingWebhook = webhooks.find(
      (w) => w.handler?.actionId === args.actionId
    );

    if (referencingWebhook) {
      throw new Error(
        `Cannot delete action referenced by webhook '${referencingWebhook.name}'`
      );
    }

    // Create audit log before deletion
    await createAuditLog(ctx, {
      workspaceId: args.workspaceId,
      entityType: "action",
      entityId: args.actionId,
      action: "delete",
      changes: [{ field: "name", before: action.name, after: null }],
      beforeSnapshot: {
        name: action.name,
        slug: action.slug,
        description: action.description,
        trigger: action.trigger,
        isActive: action.isActive,
      },
      actorId: args.actorId,
      actorType: "user",
    });

    // Delete action
    await ctx.db.delete(args.actionId);

    return { success: true };
  },
});
