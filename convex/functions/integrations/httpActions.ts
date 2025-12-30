import { action, internalAction } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { v } from "convex/values";
import type { Id } from "../../_generated/dataModel";
import { validateUrlForFetch } from "../../lib/urlValidation";
import { getNestedValue } from "../../lib/interpolation";

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function buildAuthHeader(
  authConfig: {
    type: string;
    tokenEnvVar?: string;
    usernameEnvVar?: string;
    passwordEnvVar?: string;
    headerName?: string;
    keyEnvVar?: string;
  } | undefined
): { headerName: string; headerValue: string } | null {
  if (!authConfig || authConfig.type === "none") {
    return null;
  }

  switch (authConfig.type) {
    case "bearer": {
      const token = authConfig.tokenEnvVar
        ? process.env[authConfig.tokenEnvVar]
        : undefined;
      if (token) {
        return { headerName: "Authorization", headerValue: `Bearer ${token}` };
      }
      break;
    }
    case "basic": {
      const username = authConfig.usernameEnvVar
        ? process.env[authConfig.usernameEnvVar]
        : undefined;
      const password = authConfig.passwordEnvVar
        ? process.env[authConfig.passwordEnvVar]
        : undefined;
      if (username && password) {
        const encoded = Buffer.from(`${username}:${password}`).toString("base64");
        return { headerName: "Authorization", headerValue: `Basic ${encoded}` };
      }
      break;
    }
    case "apiKey": {
      const key = authConfig.keyEnvVar
        ? process.env[authConfig.keyEnvVar]
        : undefined;
      const headerName = authConfig.headerName ?? "X-API-Key";
      if (key) {
        return { headerName, headerValue: key };
      }
      break;
    }
  }

  return null;
}

function sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
  const sanitized = { ...headers };
  const sensitiveKeys = ["authorization", "x-api-key", "api-key", "token", "secret"];

  for (const key of Object.keys(sanitized)) {
    if (sensitiveKeys.some((s) => key.toLowerCase().includes(s))) {
      sanitized[key] = "[REDACTED]";
    }
  }

  return sanitized;
}

// Types for the shared HTTP execution helper
interface HttpRequestParams {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
  authConfig?: {
    type: string;
    tokenEnvVar?: string;
    usernameEnvVar?: string;
    passwordEnvVar?: string;
    headerName?: string;
    keyEnvVar?: string;
  };
}

interface HttpRequestResult {
  success: boolean;
  statusCode?: number;
  body?: unknown;
  error?: string;
  durationMs: number;
  // Data needed for logging
  requestHeaders: Record<string, string>;
  sentAt: number;
  completedAt: number;
}

async function executeHttpRequest(params: HttpRequestParams): Promise<HttpRequestResult> {
  const sentAt = Date.now();

  // Validate URL to prevent SSRF attacks
  const urlValidation = validateUrlForFetch(params.url);
  if (!urlValidation.valid) {
    const completedAt = Date.now();
    return {
      success: false,
      error: `SSRF blocked: ${urlValidation.error}`,
      durationMs: completedAt - sentAt,
      requestHeaders: {},
      sentAt,
      completedAt,
    };
  }

  // Build headers
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(params.headers ?? {}),
  };

  // Add auth header if configured
  const authHeader = buildAuthHeader(params.authConfig);
  if (authHeader) {
    headers[authHeader.headerName] = authHeader.headerValue;
  }

  // Set up timeout (30 seconds default)
  const timeoutMs = 30000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(params.url, {
      method: params.method,
      headers,
      body: params.body ? JSON.stringify(params.body) : undefined,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const completedAt = Date.now();
    const responseText = await response.text();
    const responseBody = tryParseJson(responseText);

    return {
      success: response.ok,
      statusCode: response.status,
      body: responseBody,
      durationMs: completedAt - sentAt,
      requestHeaders: sanitizeHeaders(headers),
      sentAt,
      completedAt,
    };
  } catch (error) {
    clearTimeout(timeoutId);
    const completedAt = Date.now();

    // Check if it was a timeout
    if (error instanceof Error && error.name === "AbortError") {
      return {
        success: false,
        error: `Request timeout after ${timeoutMs}ms`,
        durationMs: completedAt - sentAt,
        requestHeaders: sanitizeHeaders(headers),
        sentAt,
        completedAt,
      };
    }

    const errorMessage = error instanceof Error ? error.message : String(error);

    return {
      success: false,
      error: errorMessage,
      durationMs: completedAt - sentAt,
      requestHeaders: sanitizeHeaders(headers),
      sentAt,
      completedAt,
    };
  }
}

// Supports direct mode (url/method) or template mode (templateSlug/variables)
export const sendHttpRequest = internalAction({
  args: {
    workspaceId: v.string(),
    // Direct mode params (optional if using template)
    method: v.optional(v.string()),
    url: v.optional(v.string()),
    headers: v.optional(v.any()),
    body: v.optional(v.any()),
    authConfig: v.optional(
      v.object({
        type: v.string(),
        tokenEnvVar: v.optional(v.string()),
        usernameEnvVar: v.optional(v.string()),
        passwordEnvVar: v.optional(v.string()),
        headerName: v.optional(v.string()),
        keyEnvVar: v.optional(v.string()),
      })
    ),
    // Template mode params
    templateSlug: v.optional(v.string()),
    variables: v.optional(v.any()),
    // Context for logging
    templateId: v.optional(v.string()),
    actionExecutionId: v.optional(v.string()),
    stepId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    let method: string;
    let url: string;
    let headers: Record<string, string> | undefined;
    let body: unknown;
    let authConfig: typeof args.authConfig;
    let templateId: string | undefined = args.templateId;

    if (args.templateSlug) {
      // Template mode: resolve template and interpolate variables
      const template = await ctx.runQuery(
        internal.functions.integrations.queries.getTemplateBySlug,
        {
          workspaceId: args.workspaceId as Id<"workspaces">,
          slug: args.templateSlug,
        }
      ) as HttpTemplate | null;

      if (!template) {
        // Log the error and return
        const sentAt = Date.now();
        await ctx.runMutation(internal.functions.integrations.mutations.logHttpRequest, {
          workspaceId: args.workspaceId,
          actionExecutionId: args.actionExecutionId,
          stepId: args.stepId,
          method: "GET",
          url: "",
          requestHeaders: {},
          status: "failed",
          error: `Template '${args.templateSlug}' not found`,
          sentAt,
          completedAt: sentAt,
          durationMs: 0,
        });
        return {
          success: false,
          error: `Template '${args.templateSlug}' not found`,
        };
      }

      const variables = args.variables ?? {};
      method = template.method;
      url = interpolateString(template.url, variables);
      headers = interpolateObject(template.headers ?? {}, variables) as Record<string, string> | undefined;
      body = interpolateObject(template.body, variables);
      authConfig = template.auth;
      templateId = template._id;
    } else {
      // Direct mode: use provided params
      method = args.method ?? "POST";
      url = args.url ?? "";
      headers = args.headers;
      body = args.body;
      authConfig = args.authConfig;
    }

    const result = await executeHttpRequest({
      method,
      url,
      headers,
      body,
      authConfig,
    });

    // Log the request
    await ctx.runMutation(internal.functions.integrations.mutations.logHttpRequest, {
      workspaceId: args.workspaceId,
      templateId,
      actionExecutionId: args.actionExecutionId,
      stepId: args.stepId,
      method,
      url,
      requestHeaders: result.requestHeaders,
      requestBody: body,
      status: result.success ? "success" : "failed",
      statusCode: result.statusCode,
      responseBody: result.body,
      error: result.error,
      sentAt: result.sentAt,
      completedAt: result.completedAt,
      durationMs: result.durationMs,
    });

    return {
      success: result.success,
      statusCode: result.statusCode,
      body: result.body,
      error: result.error,
      durationMs: result.durationMs,
    };
  },
});

export const sendRequest = action({
  args: {
    workspaceId: v.id("workspaces"),
    method: v.string(),
    url: v.string(),
    headers: v.optional(v.any()),
    body: v.optional(v.any()),
    authConfig: v.optional(
      v.object({
        type: v.string(),
        tokenEnvVar: v.optional(v.string()),
        usernameEnvVar: v.optional(v.string()),
        passwordEnvVar: v.optional(v.string()),
        headerName: v.optional(v.string()),
        keyEnvVar: v.optional(v.string()),
      })
    ),
    actorId: v.id("workspaceMembers"),
  },
  handler: async (ctx, args) => {
    const result = await executeHttpRequest({
      method: args.method,
      url: args.url,
      headers: args.headers,
      body: args.body,
      authConfig: args.authConfig,
    });

    // Log the request
    await ctx.runMutation(internal.functions.integrations.mutations.logHttpRequest, {
      workspaceId: args.workspaceId,
      method: args.method,
      url: args.url,
      requestHeaders: result.requestHeaders,
      requestBody: args.body,
      status: result.success ? "success" : "failed",
      statusCode: result.statusCode,
      responseBody: result.body,
      error: result.error,
      sentAt: result.sentAt,
      completedAt: result.completedAt,
      durationMs: result.durationMs,
    });

    return {
      success: result.success,
      statusCode: result.statusCode,
      body: result.body,
      error: result.error,
      durationMs: result.durationMs,
    };
  },
});

// Type for HTTP template from database
interface HttpTemplate {
  _id: string;
  workspaceId: string;
  name: string;
  slug: string;
  description?: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
  auth?: {
    type: "none" | "bearer" | "basic" | "apiKey";
    tokenEnvVar?: string;
    usernameEnvVar?: string;
    passwordEnvVar?: string;
    headerName?: string;
    keyEnvVar?: string;
  };
  expectedStatusCodes?: number[];
  createdAt: number;
  updatedAt: number;
}

export const sendFromTemplate = action({
  args: {
    workspaceId: v.id("workspaces"),
    templateSlug: v.string(),
    variables: v.optional(v.any()),
    actorId: v.id("workspaceMembers"),
  },
  handler: async (ctx, args): Promise<{
    success: boolean;
    statusCode?: number;
    body?: unknown;
    error?: string;
    durationMs?: number;
  }> => {
    // Get the template
    const template = await ctx.runQuery(
      internal.functions.integrations.queries.getTemplateBySlug,
      {
        workspaceId: args.workspaceId,
        slug: args.templateSlug,
      }
    ) as HttpTemplate | null;

    if (!template) {
      return {
        success: false,
        error: `Template '${args.templateSlug}' not found`,
      };
    }

    // Interpolate variables into URL, headers, and body
    const variables = args.variables ?? {};
    const url = interpolateString(template.url, variables);
    const interpolatedHeaders = interpolateObject(template.headers ?? {}, variables) as Record<string, string> | undefined;
    const body = interpolateObject(template.body, variables);

    const result = await executeHttpRequest({
      method: template.method,
      url,
      headers: interpolatedHeaders,
      body,
      authConfig: template.auth,
    });

    // Log the request
    await ctx.runMutation(internal.functions.integrations.mutations.logHttpRequest, {
      workspaceId: args.workspaceId,
      templateId: template._id,
      method: template.method,
      url,
      requestHeaders: result.requestHeaders,
      requestBody: body,
      status: result.success ? "success" : "failed",
      statusCode: result.statusCode,
      responseBody: result.body,
      error: result.error,
      sentAt: result.sentAt,
      completedAt: result.completedAt,
      durationMs: result.durationMs,
    });

    return {
      success: result.success,
      statusCode: result.statusCode,
      body: result.body,
      error: result.error,
      durationMs: result.durationMs,
    };
  },
});

function interpolateString(template: string, variables: Record<string, unknown>): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (_, path: string) => {
    const value = getNestedValue(variables, path.trim().split("."));
    if (value === undefined || value === null) {
      return "";
    }
    return String(value);
  });
}

function interpolateObject(obj: unknown, variables: Record<string, unknown>): unknown {
  if (typeof obj === "string") {
    // Check if entire string is a single placeholder
    const match = obj.match(/^\{\{([^}]+)\}\}$/);
    if (match) {
      return getNestedValue(variables, match[1].trim().split("."));
    }
    return interpolateString(obj, variables);
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => interpolateObject(item, variables));
  }

  if (obj !== null && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(obj)) {
      result[key] = interpolateObject(val, variables);
    }
    return result;
  }

  return obj;
}

