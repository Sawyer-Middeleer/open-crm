import { query, internalQuery } from "../../_generated/server";
import { v } from "convex/values";
import { assertActorInWorkspace } from "../../lib/auth";

// ============================================================================
// INCOMING WEBHOOKS
// ============================================================================

/**
 * List incoming webhooks for a workspace
 */
export const listIncomingWebhooks = query({
  args: {
    workspaceId: v.id("workspaces"),
    includeInactive: v.optional(v.boolean()),
    actorId: v.id("workspaceMembers"),
  },
  handler: async (ctx, args) => {
    // Verify the actor has access to this workspace
    await assertActorInWorkspace(ctx, args.workspaceId, args.actorId);

    let webhooks = await ctx.db
      .query("incomingWebhooks")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();

    if (!args.includeInactive) {
      webhooks = webhooks.filter((w) => w.isActive);
    }

    // Build URLs for each webhook
    const siteUrl = process.env.CONVEX_SITE_URL ?? "https://your-deployment.convex.site";

    return webhooks.map((w) => ({
      ...w,
      url: `${siteUrl}/webhooks/${args.workspaceId}/${w.slug}`,
      // Never expose secret in list view
      secret: undefined,
    }));
  },
});

/**
 * Get a single incoming webhook
 */
export const getIncomingWebhook = query({
  args: {
    workspaceId: v.id("workspaces"),
    webhookId: v.id("incomingWebhooks"),
    actorId: v.id("workspaceMembers"),
  },
  handler: async (ctx, args) => {
    // Verify the actor has access to this workspace
    await assertActorInWorkspace(ctx, args.workspaceId, args.actorId);

    const webhook = await ctx.db.get(args.webhookId);

    if (!webhook || webhook.workspaceId !== args.workspaceId) {
      return null;
    }

    const siteUrl = process.env.CONVEX_SITE_URL ?? "https://your-deployment.convex.site";

    return {
      ...webhook,
      url: `${siteUrl}/webhooks/${args.workspaceId}/${webhook.slug}`,
      // Never expose secret in query (only shown on create/regenerate)
      secret: undefined,
    };
  },
});

/**
 * Get incoming webhook by slug (internal, used by HTTP handler)
 */
export const getWebhookBySlug = internalQuery({
  args: {
    workspaceId: v.string(),
    slug: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("incomingWebhooks")
      .withIndex("by_workspace_slug", (q: any) =>
        q.eq("workspaceId", args.workspaceId).eq("slug", args.slug)
      )
      .first();
  },
});

/**
 * Get webhook logs
 */
export const getWebhookLogs = query({
  args: {
    workspaceId: v.id("workspaces"),
    webhookId: v.optional(v.id("incomingWebhooks")),
    limit: v.optional(v.number()),
    actorId: v.id("workspaceMembers"),
  },
  handler: async (ctx, args) => {
    // Verify the actor has access to this workspace
    await assertActorInWorkspace(ctx, args.workspaceId, args.actorId);

    const limit = args.limit ?? 50;

    let logsQuery;
    if (args.webhookId) {
      logsQuery = ctx.db
        .query("webhookLogs")
        .withIndex("by_webhook", (q) => q.eq("webhookId", args.webhookId!))
        .order("desc");
    } else {
      logsQuery = ctx.db
        .query("webhookLogs")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
        .order("desc");
    }

    return await logsQuery.take(limit);
  },
});

// ============================================================================
// HTTP TEMPLATES
// ============================================================================

/**
 * List HTTP templates for a workspace
 */
export const listHttpTemplates = query({
  args: {
    workspaceId: v.id("workspaces"),
    actorId: v.id("workspaceMembers"),
  },
  handler: async (ctx, args) => {
    // Verify the actor has access to this workspace
    await assertActorInWorkspace(ctx, args.workspaceId, args.actorId);

    return await ctx.db
      .query("httpTemplates")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();
  },
});

/**
 * Get a single HTTP template
 */
export const getHttpTemplate = query({
  args: {
    workspaceId: v.id("workspaces"),
    templateId: v.id("httpTemplates"),
    actorId: v.id("workspaceMembers"),
  },
  handler: async (ctx, args) => {
    // Verify the actor has access to this workspace
    await assertActorInWorkspace(ctx, args.workspaceId, args.actorId);

    const template = await ctx.db.get(args.templateId);

    if (!template || template.workspaceId !== args.workspaceId) {
      return null;
    }

    return template;
  },
});

/**
 * Get HTTP template by slug (internal, used by actions)
 */
export const getTemplateBySlug = internalQuery({
  args: {
    workspaceId: v.id("workspaces"),
    slug: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("httpTemplates")
      .withIndex("by_workspace_slug", (q: any) =>
        q.eq("workspaceId", args.workspaceId).eq("slug", args.slug)
      )
      .first();
  },
});

// ============================================================================
// HTTP REQUEST LOGS
// ============================================================================

/**
 * Get HTTP request logs
 */
export const getHttpRequestLogs = query({
  args: {
    workspaceId: v.id("workspaces"),
    templateId: v.optional(v.id("httpTemplates")),
    actionExecutionId: v.optional(v.id("actionExecutions")),
    limit: v.optional(v.number()),
    actorId: v.id("workspaceMembers"),
  },
  handler: async (ctx, args) => {
    // Verify the actor has access to this workspace
    await assertActorInWorkspace(ctx, args.workspaceId, args.actorId);

    const limit = args.limit ?? 50;

    // Query by workspace
    let logs = await ctx.db
      .query("httpRequestLogs")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .order("desc")
      .take(limit * 2); // Fetch extra for filtering

    // Filter by template if specified
    if (args.templateId) {
      logs = logs.filter((l) => l.templateId === args.templateId);
    }

    // Filter by action execution if specified
    if (args.actionExecutionId) {
      logs = logs.filter((l) => l.actionExecutionId === args.actionExecutionId);
    }

    return logs.slice(0, limit);
  },
});
