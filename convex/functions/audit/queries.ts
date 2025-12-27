import { query } from "../../_generated/server";
import { v } from "convex/values";

export const getRecordHistory = query({
  args: {
    workspaceId: v.id("workspaces"),
    recordId: v.id("records"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50;

    const logs = await ctx.db
      .query("auditLogs")
      .withIndex("by_workspace_entity", (q) =>
        q
          .eq("workspaceId", args.workspaceId)
          .eq("entityType", "record")
          .eq("entityId", args.recordId)
      )
      .order("desc")
      .take(limit);

    // Enrich with actor info
    const enrichedLogs = await Promise.all(
      logs.map(async (log) => {
        let actor = null;
        if (log.actorId) {
          const member = await ctx.db.get(log.actorId);
          if (member) {
            // Get user email from users table
            const user = await ctx.db.get(member.userId);
            actor = { id: member._id, email: user?.email };
          }
        }

        return {
          id: log._id,
          action: log.action,
          changes: log.changes,
          actor,
          actorType: log.actorType,
          timestamp: log.timestamp,
          metadata: log.metadata,
        };
      })
    );

    return enrichedLogs;
  },
});

export const getWorkspaceActivity = query({
  args: {
    workspaceId: v.id("workspaces"),
    limit: v.optional(v.number()),
    since: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 100;

    let logsQuery = ctx.db
      .query("auditLogs")
      .withIndex("by_workspace_timestamp", (q) => {
        if (args.since) {
          return q.eq("workspaceId", args.workspaceId).gte("timestamp", args.since);
        }
        return q.eq("workspaceId", args.workspaceId);
      })
      .order("desc");

    const logs = await logsQuery.take(limit);

    return logs.map((log) => ({
      id: log._id,
      entityType: log.entityType,
      entityId: log.entityId,
      action: log.action,
      changes: log.changes,
      actorType: log.actorType,
      timestamp: log.timestamp,
    }));
  },
});
