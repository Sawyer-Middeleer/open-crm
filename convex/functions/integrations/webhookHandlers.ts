import { internalMutation } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { v } from "convex/values";
import type { Id } from "../../_generated/dataModel";
import { getNestedValue } from "../../lib/interpolation";

interface ActionExecutionResult {
  executionId: Id<"actionExecutions">;
  status: "completed" | "failed";
  stepResults: Array<{
    stepId: string;
    status: "completed" | "failed";
    startedAt: number;
    completedAt: number;
    output?: unknown;
    error?: string;
  }>;
}

/**
 * Create a record from webhook payload using field mapping
 */
export const createRecordFromWebhook = internalMutation({
  args: {
    workspaceId: v.string(),
    objectTypeId: v.id("objectTypes"),
    fieldMapping: v.optional(v.any()),
    payload: v.any(),
    actorId: v.id("workspaceMembers"),
  },
  handler: async (ctx, args) => {
    // Get object type to understand field definitions
    const objectType = await ctx.db.get(args.objectTypeId);
    if (!objectType) {
      throw new Error("Object type not found");
    }

    // Get attributes for this object type to validate field slugs
    const attributes = await ctx.db
      .query("attributes")
      .withIndex("by_object_type", (q) => q.eq("objectTypeId", args.objectTypeId))
      .collect();

    const attributeSlugs = attributes.map((a) => a.slug);

    // Build field values from payload using mapping
    const data: Record<string, unknown> = {};

    if (args.fieldMapping && typeof args.fieldMapping === "object") {
      // fieldMapping format: { "payload.path": "fieldSlug", ... }
      for (const [payloadPath, fieldSlug] of Object.entries(args.fieldMapping)) {
        if (typeof fieldSlug === "string") {
          const value = getNestedValue(args.payload, payloadPath);
          if (value !== undefined) {
            data[fieldSlug] = value;
          }
        }
      }
    } else {
      // No mapping: try to match payload keys directly to attribute slugs
      if (typeof args.payload === "object" && args.payload !== null) {
        for (const [key, value] of Object.entries(args.payload)) {
          if (attributeSlugs.includes(key)) {
            data[key] = value;
          }
        }
      }
    }

    // Create the record with the provided actor
    const now = Date.now();
    const recordId = await ctx.db.insert("records", {
      workspaceId: args.workspaceId as Id<"workspaces">,
      objectTypeId: args.objectTypeId,
      data,
      createdBy: args.actorId,
      createdAt: now,
      updatedAt: now,
    });

    return recordId;
  },
});

/**
 * Trigger an action from webhook payload
 * Requires recordId and actorId in the webhook payload
 */
export const triggerActionFromWebhook = internalMutation({
  args: {
    workspaceId: v.string(),
    actionId: v.id("actions"),
    recordId: v.string(),
    actorId: v.string(),
    payload: v.any(),
  },
  handler: async (ctx, args): Promise<ActionExecutionResult> => {
    // Validate action exists and is active
    const action = await ctx.db.get(args.actionId);
    if (!action) {
      throw new Error("Action not found");
    }
    if (!action.isActive) {
      throw new Error("Action is not active");
    }

    // Validate record exists and belongs to workspace
    const record = await ctx.db.get(args.recordId as Id<"records">);
    if (!record || record.workspaceId !== args.workspaceId) {
      throw new Error("Record not found");
    }

    // Validate actor exists and belongs to workspace
    const actor = await ctx.db.get(args.actorId as Id<"workspaceMembers">);
    if (!actor || actor.workspaceId !== args.workspaceId) {
      throw new Error("Actor not found in workspace");
    }

    // Execute action via shared internal mutation
    return ctx.runMutation(
      internal.functions.actions.mutations.executeInternal,
      {
        workspaceId: args.workspaceId as Id<"workspaces">,
        actionId: args.actionId,
        recordId: args.recordId as Id<"records">,
        actorId: args.actorId as Id<"workspaceMembers">,
        triggeredBy: "automatic",
      }
    );
  },
});
