/**
 * OAuth 2.1 Coarse-Grained Scopes for Agent CRM
 *
 * Scope hierarchy: crm:admin > crm:write > crm:read
 * - crm:read: Read-only access to all CRM data
 * - crm:write: Read and write access (includes crm:read)
 * - crm:admin: Full access including workspace creation (includes crm:write)
 */

export const SCOPES = {
  "crm:read": "Read all CRM data (records, lists, schema, audit)",
  "crm:write": "Read and write CRM data (includes crm:read)",
  "crm:admin": "Full access including workspace creation (includes crm:write)",
} as const;

export type Scope = keyof typeof SCOPES;

/**
 * Tools requiring read-only access
 */
const READ_TOOLS = [
  "records.get",
  "records.list",
  "records.search",
  "records.getRelated",
  "records.bulkInspect",
  "schema.objectTypes.list",
  "schema.objectTypes.get",
  "lists.getEntries",
  "actions.list",
  "integrations.listWebhookEndpoints",
  "integrations.getWebhookLogs",
  "integrations.listTemplates",
  "integrations.getRequestLogs",
  "users.me",
  "audit.getHistory",
];

/**
 * Tools requiring write access (also grants read)
 */
const WRITE_TOOLS = [
  "records.create",
  "records.update",
  "records.delete",
  "records.bulkValidate",
  "records.bulkCommit",
  "schema.objectTypes.create",
  "schema.attributes.create",
  "lists.create",
  "lists.addEntry",
  "lists.removeEntry",
  "actions.create",
  "actions.execute",
  "integrations.createWebhookEndpoint",
  "integrations.createTemplate",
  "integrations.sendRequest",
  "users.updatePreferences",
];

/**
 * Tools requiring admin access (also grants write and read)
 */
const ADMIN_TOOLS = ["workspace.create"];

/**
 * Get the required scope for a given tool name
 */
export function getRequiredScope(toolName: string): Scope {
  if (ADMIN_TOOLS.includes(toolName)) return "crm:admin";
  if (WRITE_TOOLS.includes(toolName)) return "crm:write";
  if (READ_TOOLS.includes(toolName)) return "crm:read";
  // Default to write for unknown tools (safe default)
  return "crm:write";
}

/**
 * Check if the token's scopes satisfy the required scope
 * Respects the hierarchy: admin > write > read
 */
export function hasScope(tokenScopes: string[], required: Scope): boolean {
  // Admin can do everything
  if (tokenScopes.includes("crm:admin")) return true;

  // If admin is required but not present, deny
  if (required === "crm:admin") return false;

  // Write can do write and read
  if (tokenScopes.includes("crm:write")) return true;

  // If write is required but not present, deny
  if (required === "crm:write") return false;

  // Read can only do read
  return tokenScopes.includes("crm:read");
}

/**
 * Get all supported scopes for RFC 9728 metadata
 */
export function getSupportedScopes(): string[] {
  return Object.keys(SCOPES);
}

/**
 * Validate that scopes are valid
 */
export function validateScopes(scopes: string[]): {
  valid: boolean;
  invalidScopes: string[];
} {
  const validScopes = Object.keys(SCOPES);
  const invalidScopes = scopes.filter((s) => !validScopes.includes(s));
  return {
    valid: invalidScopes.length === 0,
    invalidScopes,
  };
}
