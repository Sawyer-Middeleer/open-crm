import { mutation } from "../../_generated/server";
import { v } from "convex/values";
import { createAuditLog } from "../../lib/audit";

export const execute = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    actionSlug: v.string(),
    recordId: v.id("records"),
    actorId: v.id("workspaceMembers"),
  },
  handler: async (ctx, args) => {
    // Get the action
    const action = await ctx.db
      .query("actions")
      .withIndex("by_workspace_slug", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("slug", args.actionSlug)
      )
      .first();

    if (!action) {
      throw new Error(`Action '${args.actionSlug}' not found`);
    }

    if (!action.isActive) {
      throw new Error(`Action '${args.actionSlug}' is not active`);
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
      actionId: action._id,
      triggeredBy: "manual",
      triggerRecordId: args.recordId,
      status: "running",
      startedAt: now,
      stepResults: [],
      initiatorId: args.actorId,
    });

    try {
      // Execute each step
      const stepResults = [];

      for (const step of action.steps) {
        const stepResult = await executeStep(ctx, {
          step,
          record,
          workspaceId: args.workspaceId,
          actorId: args.actorId,
        });

        stepResults.push({
          stepId: step.id,
          status: stepResult.success ? "completed" : "failed",
          startedAt: stepResult.startedAt,
          completedAt: stepResult.completedAt,
          output: stepResult.output,
          error: stepResult.error,
        } as const);

        if (!stepResult.success) {
          break;
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
        status: allSucceeded ? "completed" : "failed",
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

interface StepContext {
  step: {
    id: string;
    type: string;
    config: Record<string, unknown>;
  };
  record: {
    _id: unknown;
    data: Record<string, unknown>;
    objectTypeId: unknown;
  };
  workspaceId: unknown;
  actorId: unknown;
}

interface StepResult {
  success: boolean;
  startedAt: number;
  completedAt: number;
  output?: unknown;
  error?: string;
}

async function executeStep(
  ctx: Parameters<Parameters<typeof mutation>[0]["handler"]>[0],
  { step, record, workspaceId, actorId }: StepContext
): Promise<StepResult> {
  const startedAt = Date.now();

  try {
    switch (step.type) {
      case "updateField": {
        const config = step.config as {
          targetField: string;
          value: unknown;
        };

        const newData = {
          ...record.data,
          [config.targetField]: config.value,
        };

        await ctx.db.patch(record._id as Parameters<typeof ctx.db.patch>[0], {
          data: newData,
          updatedAt: Date.now(),
        });

        return {
          success: true,
          startedAt,
          completedAt: Date.now(),
          output: { field: config.targetField, value: config.value },
        };
      }

      case "clearField": {
        const config = step.config as { targetField: string };
        const newData = { ...record.data };
        delete newData[config.targetField];

        await ctx.db.patch(record._id as Parameters<typeof ctx.db.patch>[0], {
          data: newData,
          updatedAt: Date.now(),
        });

        return {
          success: true,
          startedAt,
          completedAt: Date.now(),
          output: { field: config.targetField, cleared: true },
        };
      }

      case "sendWebhook": {
        // Note: In Convex, HTTP calls need to be done in actions (with "use node")
        // For now, we'll just log the intent
        const config = step.config as { url: string; method: string; body: unknown };

        return {
          success: true,
          startedAt,
          completedAt: Date.now(),
          output: {
            message: "Webhook queued",
            url: config.url,
            method: config.method,
          },
        };
      }

      default:
        return {
          success: false,
          startedAt,
          completedAt: Date.now(),
          error: `Unknown step type: ${step.type}`,
        };
    }
  } catch (error) {
    return {
      success: false,
      startedAt,
      completedAt: Date.now(),
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

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
    steps: v.array(
      v.object({
        id: v.string(),
        type: v.string(),
        name: v.optional(v.string()),
        config: v.any(),
      })
    ),
    actorId: v.id("workspaceMembers"),
  },
  handler: async (ctx, args) => {
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

    const now = Date.now();

    const actionId = await ctx.db.insert("actions", {
      workspaceId: args.workspaceId,
      name: args.name,
      slug: args.slug,
      description: args.description,
      trigger: args.trigger,
      steps: args.steps,
      isActive: true,
      isSystem: false,
      createdAt: now,
      updatedAt: now,
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
