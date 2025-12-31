/**
 * Input validation utilities for MCP server
 * Validates user input before passing to Convex
 */

/**
 * Convex ID format pattern
 * IDs are base64url-like alphanumeric strings
 */
const CONVEX_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

/**
 * Validate that a string is a valid Convex ID format
 * @throws Error if ID is missing or malformed
 */
export function validateConvexId(id: string, fieldName: string): void {
  if (!id || typeof id !== "string") {
    throw new Error(`${fieldName} is required`);
  }
  if (id.length < 1 || id.length > 64) {
    throw new Error(`Invalid ${fieldName} format: invalid length`);
  }
  if (!CONVEX_ID_PATTERN.test(id)) {
    throw new Error(`Invalid ${fieldName} format: contains invalid characters`);
  }
}

/**
 * Validate optional Convex ID (only validates if provided)
 */
export function validateOptionalConvexId(
  id: string | undefined | null,
  fieldName: string
): void {
  if (id !== undefined && id !== null) {
    validateConvexId(id, fieldName);
  }
}

// Convenience validators for common ID types
export function validateRecordId(id: string): void {
  validateConvexId(id, "recordId");
}

export function validateSessionId(id: string): void {
  validateConvexId(id, "sessionId");
}

export function validateWebhookId(id: string): void {
  validateConvexId(id, "webhookId");
}

export function validateTemplateId(id: string): void {
  validateConvexId(id, "templateId");
}

export function validateWorkspaceId(id: string): void {
  validateConvexId(id, "workspaceId");
}

export function validateOptionalWorkspaceId(
  id: string | undefined | null
): void {
  validateOptionalConvexId(id, "workspaceId");
}

export function validateActionId(id: string): void {
  validateConvexId(id, "actionId");
}

export function validateApiKeyId(id: string): void {
  validateConvexId(id, "apiKeyId");
}
