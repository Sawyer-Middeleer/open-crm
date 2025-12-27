import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { computeHmacSignature } from "./functions/integrations/mutations";

const http = httpRouter();

/**
 * Handle incoming webhook requests
 * Route: POST /webhooks/:workspaceId/:slug
 */
http.route({
  path: "/webhooks/{workspaceId}/{slug}",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    // Extract path parameters from URL
    const url = new URL(request.url);
    const pathParts = url.pathname.split("/").filter(Boolean);

    // Expected format: /webhooks/{workspaceId}/{slug}
    if (pathParts.length < 3 || pathParts[0] !== "webhooks") {
      return new Response(JSON.stringify({ error: "Invalid webhook path" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const workspaceId = pathParts[1];
    const slug = pathParts[2];

    // Get source IP for logging
    const sourceIp = request.headers.get("x-forwarded-for")?.split(",")[0] ||
                     request.headers.get("x-real-ip") ||
                     undefined;

    // Look up the webhook configuration
    const webhook = await ctx.runQuery(
      internal.functions.integrations.queries.getWebhookBySlug,
      { workspaceId, slug }
    );

    if (!webhook) {
      return new Response(JSON.stringify({ error: "Webhook not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Check if webhook is active
    if (!webhook.isActive) {
      await ctx.runMutation(internal.functions.integrations.mutations.logIncomingWebhook, {
        workspaceId,
        webhookId: webhook._id,
        headers: Object.fromEntries(request.headers.entries()),
        sourceIp,
        status: "inactive",
        error: "Webhook is disabled",
      });

      return new Response(JSON.stringify({ error: "Webhook is disabled" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Parse the request body
    let payload: unknown;
    try {
      const bodyText = await request.text();
      payload = JSON.parse(bodyText);

      // Verify HMAC signature if provided
      const signature = request.headers.get("x-webhook-signature");
      if (signature) {
        const expectedSignature = await computeHmacSignature(bodyText, webhook.secret);
        if (signature !== expectedSignature && signature !== `sha256=${expectedSignature}`) {
          await ctx.runMutation(internal.functions.integrations.mutations.logIncomingWebhook, {
            workspaceId,
            webhookId: webhook._id,
            headers: Object.fromEntries(request.headers.entries()),
            payload,
            sourceIp,
            status: "invalid_signature",
            error: "Invalid signature",
          });

          return new Response(JSON.stringify({ error: "Invalid signature" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }
      }
    } catch {
      await ctx.runMutation(internal.functions.integrations.mutations.logIncomingWebhook, {
        workspaceId,
        webhookId: webhook._id,
        headers: Object.fromEntries(request.headers.entries()),
        sourceIp,
        status: "failed",
        error: "Invalid JSON payload",
      });

      return new Response(JSON.stringify({ error: "Invalid JSON payload" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Process the webhook based on handler type
    try {
      let result: { createdRecordId?: string; triggeredActionId?: string; actionExecutionId?: string } = {};

      if (webhook.handler.type === "createRecord" && webhook.handler.objectTypeId) {
        // Create a new record from the webhook payload
        const recordId = await ctx.runMutation(
          internal.functions.integrations.webhookHandlers.createRecordFromWebhook,
          {
            workspaceId,
            objectTypeId: webhook.handler.objectTypeId,
            fieldMapping: webhook.handler.fieldMapping,
            payload,
          }
        );
        result.createdRecordId = recordId;
      } else if (webhook.handler.type === "triggerAction" && webhook.handler.actionId) {
        // Trigger an action with the webhook payload as context
        const executionId = await ctx.runMutation(
          internal.functions.integrations.webhookHandlers.triggerActionFromWebhook,
          {
            workspaceId,
            actionId: webhook.handler.actionId,
            payload,
          }
        );
        result.triggeredActionId = webhook.handler.actionId;
        result.actionExecutionId = executionId;
      }

      // Log successful webhook
      await ctx.runMutation(internal.functions.integrations.mutations.logIncomingWebhook, {
        workspaceId,
        webhookId: webhook._id,
        headers: Object.fromEntries(request.headers.entries()),
        payload,
        sourceIp,
        status: "success",
        createdRecordId: result.createdRecordId,
        triggeredActionId: result.triggeredActionId,
        actionExecutionId: result.actionExecutionId,
      });

      // Update webhook stats
      await ctx.runMutation(internal.functions.integrations.mutations.updateWebhookStats, {
        webhookId: webhook._id,
      });

      return new Response(JSON.stringify({
        success: true,
        ...result
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      await ctx.runMutation(internal.functions.integrations.mutations.logIncomingWebhook, {
        workspaceId,
        webhookId: webhook._id,
        headers: Object.fromEntries(request.headers.entries()),
        payload,
        sourceIp,
        status: "failed",
        error: errorMessage,
      });

      return new Response(JSON.stringify({ error: errorMessage }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  }),
});

// Health check endpoint
http.route({
  path: "/health",
  method: "GET",
  handler: httpAction(async () => {
    return new Response(JSON.stringify({ status: "ok", timestamp: Date.now() }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }),
});

export default http;
