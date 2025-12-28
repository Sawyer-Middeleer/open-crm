import { mutation, internalMutation } from "../../_generated/server";
import { v } from "convex/values";
import { assertActorInWorkspace } from "../../lib/auth";

/**
 * Generate a random webhook secret using Web Crypto API
 */
function generateWebhookSecret(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `whsec_${hex}`;
}

/**
 * Compute HMAC-SHA256 signature using Web Crypto API
 */
export async function computeHmacSignature(
  payload: string,
  secret: string
): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const data = encoder.encode(payload);

  const key = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign("HMAC", key, data);
  const hashArray = Array.from(new Uint8Array(signature));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ============================================================================
// HTTP REQUEST LOGGING
// ============================================================================

/**
 * Log an HTTP request (internal mutation called from actions)
 */
export const logHttpRequest = internalMutation({
  args: {
    workspaceId: v.string(),
    templateId: v.optional(v.string()),
    actionExecutionId: v.optional(v.string()),
    stepId: v.optional(v.string()),
    method: v.string(),
    url: v.string(),
    requestHeaders: v.optional(v.any()),
    requestBody: v.optional(v.any()),
    status: v.union(
      v.literal("success"),
      v.literal("failed"),
      v.literal("timeout")
    ),
    statusCode: v.optional(v.number()),
    responseHeaders: v.optional(v.any()),
    responseBody: v.optional(v.any()),
    error: v.optional(v.string()),
    sentAt: v.number(),
    completedAt: v.optional(v.number()),
    durationMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("httpRequestLogs", {
      workspaceId: args.workspaceId as any,
      templateId: args.templateId as any,
      actionExecutionId: args.actionExecutionId as any,
      stepId: args.stepId,
      method: args.method,
      url: args.url,
      requestHeaders: args.requestHeaders,
      requestBody: args.requestBody,
      status: args.status,
      statusCode: args.statusCode,
      responseHeaders: args.responseHeaders,
      responseBody: args.responseBody,
      error: args.error,
      sentAt: args.sentAt,
      completedAt: args.completedAt,
      durationMs: args.durationMs,
    });
  },
});

// ============================================================================
// INCOMING WEBHOOKS
// ============================================================================

/**
 * Create an incoming webhook endpoint
 */
export const createIncomingWebhook = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    name: v.string(),
    slug: v.string(),
    description: v.optional(v.string()),
    handler: v.object({
      type: v.union(v.literal("createRecord"), v.literal("triggerAction")),
      objectType: v.optional(v.string()), // slug
      fieldMapping: v.optional(v.any()),
      actionSlug: v.optional(v.string()),
    }),
    actorId: v.id("workspaceMembers"),
  },
  handler: async (ctx, args) => {
    // Verify the actor has access to this workspace
    await assertActorInWorkspace(ctx, args.workspaceId, args.actorId);

    // Check for duplicate slug
    const existing = await ctx.db
      .query("incomingWebhooks")
      .withIndex("by_workspace_slug", (q: any) =>
        q.eq("workspaceId", args.workspaceId).eq("slug", args.slug)
      )
      .first();

    if (existing) {
      throw new Error(`Webhook with slug '${args.slug}' already exists`);
    }

    // Resolve object type if specified
    let objectTypeId;
    if (args.handler.objectType) {
      const objectType = await ctx.db
        .query("objectTypes")
        .withIndex("by_workspace_slug", (q: any) =>
          q.eq("workspaceId", args.workspaceId).eq("slug", args.handler.objectType)
        )
        .first();

      if (!objectType) {
        throw new Error(`Object type '${args.handler.objectType}' not found`);
      }
      objectTypeId = objectType._id;
    }

    // Resolve action if specified
    let actionId;
    if (args.handler.actionSlug) {
      const action = await ctx.db
        .query("actions")
        .withIndex("by_workspace_slug", (q: any) =>
          q.eq("workspaceId", args.workspaceId).eq("slug", args.handler.actionSlug)
        )
        .first();

      if (!action) {
        throw new Error(`Action '${args.handler.actionSlug}' not found`);
      }
      actionId = action._id;
    }

    // Generate secret
    const secret = generateWebhookSecret();
    const now = Date.now();

    const webhookId = await ctx.db.insert("incomingWebhooks", {
      workspaceId: args.workspaceId,
      name: args.name,
      slug: args.slug,
      description: args.description,
      secret,
      isActive: true,
      handler: {
        type: args.handler.type,
        objectTypeId,
        fieldMapping: args.handler.fieldMapping,
        actionId,
      },
      lastReceivedAt: undefined,
      totalReceived: 0,
      createdAt: now,
      updatedAt: now,
    });

    // Build webhook URL
    // Note: CONVEX_SITE_URL is set automatically by Convex in production
    const siteUrl = process.env.CONVEX_SITE_URL ?? "https://your-deployment.convex.site";
    const url = `${siteUrl}/webhooks/${args.workspaceId}/${args.slug}`;

    return {
      webhookId,
      url,
      secret, // Only shown once on creation
    };
  },
});

/**
 * Update an incoming webhook
 */
export const updateIncomingWebhook = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    webhookId: v.id("incomingWebhooks"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    isActive: v.optional(v.boolean()),
    handler: v.optional(
      v.object({
        type: v.union(v.literal("createRecord"), v.literal("triggerAction")),
        objectType: v.optional(v.string()),
        fieldMapping: v.optional(v.any()),
        actionSlug: v.optional(v.string()),
      })
    ),
    actorId: v.id("workspaceMembers"),
  },
  handler: async (ctx, args) => {
    // Verify the actor has access to this workspace
    await assertActorInWorkspace(ctx, args.workspaceId, args.actorId);

    const webhook = await ctx.db.get(args.webhookId);

    if (!webhook || webhook.workspaceId !== args.workspaceId) {
      throw new Error("Webhook not found");
    }

    const updates: Record<string, unknown> = {
      updatedAt: Date.now(),
    };

    if (args.name !== undefined) updates.name = args.name;
    if (args.description !== undefined) updates.description = args.description;
    if (args.isActive !== undefined) updates.isActive = args.isActive;

    if (args.handler) {
      // Resolve object type if specified
      let objectTypeId = webhook.handler.objectTypeId;
      if (args.handler.objectType) {
        const objectType = await ctx.db
          .query("objectTypes")
          .withIndex("by_workspace_slug", (q: any) =>
            q.eq("workspaceId", args.workspaceId).eq("slug", args.handler!.objectType)
          )
          .first();

        if (!objectType) {
          throw new Error(`Object type '${args.handler.objectType}' not found`);
        }
        objectTypeId = objectType._id;
      }

      // Resolve action if specified
      let actionId = webhook.handler.actionId;
      if (args.handler.actionSlug) {
        const action = await ctx.db
          .query("actions")
          .withIndex("by_workspace_slug", (q: any) =>
            q.eq("workspaceId", args.workspaceId).eq("slug", args.handler!.actionSlug)
          )
          .first();

        if (!action) {
          throw new Error(`Action '${args.handler.actionSlug}' not found`);
        }
        actionId = action._id;
      }

      updates.handler = {
        type: args.handler.type,
        objectTypeId,
        fieldMapping: args.handler.fieldMapping,
        actionId,
      };
    }

    await ctx.db.patch(args.webhookId, updates);

    return { webhookId: args.webhookId };
  },
});

/**
 * Delete an incoming webhook
 */
export const deleteIncomingWebhook = mutation({
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
      throw new Error("Webhook not found");
    }

    await ctx.db.delete(args.webhookId);

    return { success: true };
  },
});

/**
 * Regenerate webhook secret
 */
export const regenerateWebhookSecret = mutation({
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
      throw new Error("Webhook not found");
    }

    const newSecret = generateWebhookSecret();

    await ctx.db.patch(args.webhookId, {
      secret: newSecret,
      updatedAt: Date.now(),
    });

    return { secret: newSecret };
  },
});

/**
 * Log incoming webhook (internal mutation called from HTTP handler)
 */
export const logIncomingWebhook = internalMutation({
  args: {
    workspaceId: v.string(),
    webhookId: v.string(),
    headers: v.optional(v.any()),
    payload: v.optional(v.any()),
    sourceIp: v.optional(v.string()),
    status: v.union(
      v.literal("success"),
      v.literal("failed"),
      v.literal("invalid_signature"),
      v.literal("inactive")
    ),
    error: v.optional(v.string()),
    createdRecordId: v.optional(v.string()),
    triggeredActionId: v.optional(v.string()),
    actionExecutionId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("webhookLogs", {
      workspaceId: args.workspaceId as any,
      webhookId: args.webhookId as any,
      receivedAt: Date.now(),
      headers: args.headers,
      payload: args.payload,
      sourceIp: args.sourceIp,
      status: args.status,
      error: args.error,
      createdRecordId: args.createdRecordId as any,
      triggeredActionId: args.triggeredActionId as any,
      actionExecutionId: args.actionExecutionId as any,
    });
  },
});

// ============================================================================
// HTTP TEMPLATES
// ============================================================================

/**
 * Create an HTTP template
 */
export const createHttpTemplate = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    name: v.string(),
    slug: v.string(),
    description: v.optional(v.string()),
    method: v.union(
      v.literal("GET"),
      v.literal("POST"),
      v.literal("PUT"),
      v.literal("PATCH"),
      v.literal("DELETE")
    ),
    url: v.string(),
    headers: v.optional(v.any()),
    body: v.optional(v.any()),
    auth: v.optional(
      v.object({
        type: v.union(
          v.literal("none"),
          v.literal("bearer"),
          v.literal("basic"),
          v.literal("apiKey")
        ),
        tokenEnvVar: v.optional(v.string()),
        usernameEnvVar: v.optional(v.string()),
        passwordEnvVar: v.optional(v.string()),
        headerName: v.optional(v.string()),
        keyEnvVar: v.optional(v.string()),
      })
    ),
    expectedStatusCodes: v.optional(v.array(v.number())),
    actorId: v.id("workspaceMembers"),
  },
  handler: async (ctx, args) => {
    // Verify the actor has access to this workspace
    await assertActorInWorkspace(ctx, args.workspaceId, args.actorId);

    // Check for duplicate slug
    const existing = await ctx.db
      .query("httpTemplates")
      .withIndex("by_workspace_slug", (q: any) =>
        q.eq("workspaceId", args.workspaceId).eq("slug", args.slug)
      )
      .first();

    if (existing) {
      throw new Error(`Template with slug '${args.slug}' already exists`);
    }

    const now = Date.now();

    const templateId = await ctx.db.insert("httpTemplates", {
      workspaceId: args.workspaceId,
      name: args.name,
      slug: args.slug,
      description: args.description,
      method: args.method,
      url: args.url,
      headers: args.headers,
      body: args.body,
      auth: args.auth,
      expectedStatusCodes: args.expectedStatusCodes,
      createdAt: now,
      updatedAt: now,
    });

    return { templateId };
  },
});

/**
 * Update an HTTP template
 */
export const updateHttpTemplate = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    templateId: v.id("httpTemplates"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    method: v.optional(
      v.union(
        v.literal("GET"),
        v.literal("POST"),
        v.literal("PUT"),
        v.literal("PATCH"),
        v.literal("DELETE")
      )
    ),
    url: v.optional(v.string()),
    headers: v.optional(v.any()),
    body: v.optional(v.any()),
    auth: v.optional(
      v.object({
        type: v.union(
          v.literal("none"),
          v.literal("bearer"),
          v.literal("basic"),
          v.literal("apiKey")
        ),
        tokenEnvVar: v.optional(v.string()),
        usernameEnvVar: v.optional(v.string()),
        passwordEnvVar: v.optional(v.string()),
        headerName: v.optional(v.string()),
        keyEnvVar: v.optional(v.string()),
      })
    ),
    expectedStatusCodes: v.optional(v.array(v.number())),
    actorId: v.id("workspaceMembers"),
  },
  handler: async (ctx, args) => {
    // Verify the actor has access to this workspace
    await assertActorInWorkspace(ctx, args.workspaceId, args.actorId);

    const template = await ctx.db.get(args.templateId);

    if (!template || template.workspaceId !== args.workspaceId) {
      throw new Error("Template not found");
    }

    const updates: Record<string, unknown> = {
      updatedAt: Date.now(),
    };

    if (args.name !== undefined) updates.name = args.name;
    if (args.description !== undefined) updates.description = args.description;
    if (args.method !== undefined) updates.method = args.method;
    if (args.url !== undefined) updates.url = args.url;
    if (args.headers !== undefined) updates.headers = args.headers;
    if (args.body !== undefined) updates.body = args.body;
    if (args.auth !== undefined) updates.auth = args.auth;
    if (args.expectedStatusCodes !== undefined)
      updates.expectedStatusCodes = args.expectedStatusCodes;

    await ctx.db.patch(args.templateId, updates);

    return { templateId: args.templateId };
  },
});

/**
 * Delete an HTTP template
 */
export const deleteHttpTemplate = mutation({
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
      throw new Error("Template not found");
    }

    await ctx.db.delete(args.templateId);

    return { success: true };
  },
});

/**
 * Update webhook statistics after receiving a request (internal)
 */
export const updateWebhookStats = internalMutation({
  args: {
    webhookId: v.id("incomingWebhooks"),
  },
  handler: async (ctx, args) => {
    const webhook = await ctx.db.get(args.webhookId);
    if (!webhook) return;

    await ctx.db.patch(args.webhookId, {
      lastReceivedAt: Date.now(),
      totalReceived: webhook.totalReceived + 1,
    });
  },
});
