import { query } from "../../_generated/server";
import { v } from "convex/values";
import { assertActorInWorkspace } from "../../lib/auth";

export const get = query({
  args: {
    workspaceId: v.id("workspaces"),
    actorId: v.id("workspaceMembers"),
  },
  handler: async (ctx, args) => {
    // Verify the actor has access to this workspace
    await assertActorInWorkspace(ctx, args.workspaceId, args.actorId);

    const workspace = await ctx.db.get(args.workspaceId);
    return workspace;
  },
});

export const getBySlug = query({
  args: {
    slug: v.string(),
  },
  handler: async (ctx, args) => {
    const workspace = await ctx.db
      .query("workspaces")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .first();

    return workspace;
  },
});

// listForUser removed - use auth/queries.listUserWorkspaces instead (more complete)
