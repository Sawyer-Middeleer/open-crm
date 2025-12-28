import { query } from "../../_generated/server";
import { v } from "convex/values";
import { assertActorInWorkspace } from "../../lib/auth";

export const list = query({
  args: {
    workspaceId: v.id("workspaces"),
    objectTypeSlug: v.optional(v.string()),
    actorId: v.id("workspaceMembers"),
  },
  handler: async (ctx, args) => {
    // Verify the actor has access to this workspace
    await assertActorInWorkspace(ctx, args.workspaceId, args.actorId);

    let actions = await ctx.db
      .query("actions")
      .withIndex("by_workspace_active", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("isActive", true)
      )
      .collect();

    // Filter by object type if specified
    if (args.objectTypeSlug) {
      const objectType = await ctx.db
        .query("objectTypes")
        .withIndex("by_workspace_slug", (q) =>
          q.eq("workspaceId", args.workspaceId).eq("slug", args.objectTypeSlug!)
        )
        .first();

      if (objectType) {
        actions = actions.filter(
          (a) => a.trigger.objectTypeId === objectType._id
        );
      }
    }

    return actions.map((a) => ({
      id: a._id,
      name: a.name,
      slug: a.slug,
      description: a.description,
      trigger: a.trigger,
      isSystem: a.isSystem,
    }));
  },
});

export const get = query({
  args: {
    workspaceId: v.id("workspaces"),
    slug: v.string(),
    actorId: v.id("workspaceMembers"),
  },
  handler: async (ctx, args) => {
    // Verify the actor has access to this workspace
    await assertActorInWorkspace(ctx, args.workspaceId, args.actorId);

    const action = await ctx.db
      .query("actions")
      .withIndex("by_workspace_slug", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("slug", args.slug)
      )
      .first();

    return action;
  },
});

export const getExecutionHistory = query({
  args: {
    workspaceId: v.id("workspaces"),
    actionId: v.optional(v.id("actions")),
    limit: v.optional(v.number()),
    actorId: v.id("workspaceMembers"),
  },
  handler: async (ctx, args) => {
    // Verify the actor has access to this workspace
    await assertActorInWorkspace(ctx, args.workspaceId, args.actorId);

    const limit = args.limit ?? 50;

    let executions;

    if (args.actionId) {
      executions = await ctx.db
        .query("actionExecutions")
        .withIndex("by_action", (q) => q.eq("actionId", args.actionId!))
        .order("desc")
        .take(limit);
    } else {
      executions = await ctx.db
        .query("actionExecutions")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
        .order("desc")
        .take(limit);
    }

    return executions;
  },
});
