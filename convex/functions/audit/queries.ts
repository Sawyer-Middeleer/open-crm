import { query } from "../../_generated/server";
import { v } from "convex/values";
import { assertActorInWorkspace } from "../../lib/auth";

export const getRecordHistory = query({
  args: {
    workspaceId: v.id("workspaces"),
    recordId: v.id("records"),
    limit: v.optional(v.number()),
    actorId: v.id("workspaceMembers"),
  },
  handler: async (ctx, args) => {
    // Verify the actor has access to this workspace
    await assertActorInWorkspace(ctx, args.workspaceId, args.actorId);

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

    // Batch fetch actor info to avoid N+1 queries
    const actorIds = logs
      .map((l) => l.actorId)
      .filter((id): id is NonNullable<typeof id> => id != null);
    const uniqueActorIds = [...new Set(actorIds)];
    const members = await Promise.all(
      uniqueActorIds.map((id) => ctx.db.get(id))
    );
    const memberMap = new Map(
      members
        .filter((m): m is NonNullable<typeof m> => m != null)
        .map((m) => [m._id, m])
    );

    const userIds = [...memberMap.values()].map((m) => m.userId);
    const uniqueUserIds = [...new Set(userIds)];
    const users = await Promise.all(uniqueUserIds.map((id) => ctx.db.get(id)));
    const userMap = new Map(
      users
        .filter((u): u is NonNullable<typeof u> => u != null)
        .map((u) => [u._id, u])
    );

    // Enrich with actor info using maps
    const enrichedLogs = logs.map((log) => {
      let actor = null;
      if (log.actorId) {
        const member = memberMap.get(log.actorId);
        if (member) {
          const user = userMap.get(member.userId);
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
    });

    return enrichedLogs;
  },
});

export const getWorkspaceActivity = query({
  args: {
    workspaceId: v.id("workspaces"),
    limit: v.optional(v.number()),
    since: v.optional(v.number()),
    actorId: v.id("workspaceMembers"),
  },
  handler: async (ctx, args) => {
    // Verify the actor has access to this workspace
    await assertActorInWorkspace(ctx, args.workspaceId, args.actorId);

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
