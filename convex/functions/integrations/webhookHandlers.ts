import { internalMutation } from "../../_generated/server";
import { v } from "convex/values";
import type { Id } from "../../_generated/dataModel";

/**
 * Get nested value from object using dot notation path
 */
function getNestedValue(obj: unknown, path: string): unknown {
  const parts = path.split(".");
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
 * Create a record from webhook payload using field mapping
 */
export const createRecordFromWebhook = internalMutation({
  args: {
    workspaceId: v.string(),
    objectTypeId: v.id("objectTypes"),
    fieldMapping: v.optional(v.any()),
    payload: v.any(),
    actorId: v.optional(v.id("workspaceMembers")),
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

    // Get a system actor or use provided actor
    let createdBy = args.actorId;
    if (!createdBy) {
      // Find any workspace member to use as actor
      const member = await ctx.db
        .query("workspaceMembers")
        .withIndex("by_workspace", (q) =>
          q.eq("workspaceId", args.workspaceId as Id<"workspaces">)
        )
        .first();
      if (member) {
        createdBy = member._id;
      } else {
        throw new Error("No workspace member found to attribute record creation");
      }
    }

    // Create the record
    const now = Date.now();
    const recordId = await ctx.db.insert("records", {
      workspaceId: args.workspaceId as Id<"workspaces">,
      objectTypeId: args.objectTypeId,
      data,
      createdBy,
      createdAt: now,
      updatedAt: now,
    });

    return recordId;
  },
});

/**
 * Trigger an action from webhook payload
 * Note: For webhook-triggered actions, the execution is logged but requires
 * a target record to execute steps. Actions that don't need a record context
 * can use the webhookPayload directly in their step configurations.
 */
export const triggerActionFromWebhook = internalMutation({
  args: {
    workspaceId: v.string(),
    actionId: v.id("actions"),
    payload: v.any(),
  },
  handler: async (ctx, args) => {
    // Get the action
    const action = await ctx.db.get(args.actionId);
    if (!action) {
      throw new Error("Action not found");
    }

    // Create action execution record
    // Note: Webhook-triggered actions are logged; full async execution
    // requires the action to be configured with a target record or
    // the steps to work with webhookPayload context
    const now = Date.now();
    const executionId = await ctx.db.insert("actionExecutions", {
      workspaceId: args.workspaceId as Id<"workspaces">,
      actionId: args.actionId,
      status: "pending",
      triggeredBy: "automatic", // webhook-triggered actions are automatic
      triggerRecordId: undefined,
      stepResults: [],
      startedAt: now,
    });

    return executionId;
  },
});
