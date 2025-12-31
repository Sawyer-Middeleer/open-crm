import { z } from "zod";

/**
 * Convex ID validation pattern (base64url alphanumeric, 1-64 chars)
 */
const CONVEX_ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

/**
 * Record ID schema
 */
export const RecordIdSchema = z
  .string()
  .regex(CONVEX_ID_PATTERN, "Invalid record ID format");

/**
 * Workspace ID schema
 */
export const WorkspaceIdSchema = z
  .string()
  .regex(CONVEX_ID_PATTERN, "Invalid workspace ID format");

/**
 * Pagination query parameters
 */
export const PaginationQuerySchema = z.object({
  cursor: z.string().optional().describe("Pagination cursor from previous response"),
  numItems: z
    .string()
    .optional()
    .transform((v) => (v ? parseInt(v, 10) : 50))
    .pipe(z.number().min(1).max(100))
    .describe("Number of items per page (default: 50, max: 100)"),
});

/**
 * Standard pagination response fields
 */
export const PaginationResponseSchema = z.object({
  continueCursor: z.string().nullable().describe("Cursor for next page, null if no more pages"),
  isDone: z.boolean().describe("Whether there are more pages"),
});

/**
 * Standard error response
 */
export const ErrorResponseSchema = z.object({
  error: z.string().describe("Error code"),
  message: z.string().describe("Human-readable error message"),
  details: z
    .array(
      z.object({
        path: z.string(),
        message: z.string(),
      })
    )
    .optional()
    .describe("Validation error details"),
});

/**
 * Successful mutation response
 */
export const SuccessResponseSchema = z.object({
  success: z.literal(true),
});

/**
 * Filter operators for search
 */
export const FilterOperatorSchema = z.enum([
  "equals",
  "notEquals",
  "contains",
  "notContains",
  "greaterThan",
  "lessThan",
  "greaterThanOrEquals",
  "lessThanOrEquals",
  "isEmpty",
  "isNotEmpty",
  "in",
  "notIn",
]);

/**
 * Search filter schema
 */
export const SearchFilterSchema = z.object({
  field: z.string().describe("Attribute slug to filter on"),
  operator: FilterOperatorSchema.describe("Filter operator"),
  value: z.any().optional().describe("Value to compare against"),
});

/**
 * Attribute types
 */
export const AttributeTypeSchema = z.enum([
  "text",
  "richText",
  "number",
  "currency",
  "date",
  "datetime",
  "boolean",
  "select",
  "multiSelect",
  "email",
  "phone",
  "url",
  "reference",
  "user",
  "file",
  "json",
]);

/**
 * Action trigger types
 */
export const TriggerTypeSchema = z.enum([
  "manual",
  "onCreate",
  "onUpdate",
  "onDelete",
  "onFieldChange",
  "onListAdd",
  "onListRemove",
  "scheduled",
]);

/**
 * Action step types
 */
export const StepTypeSchema = z.enum([
  "updateField",
  "clearField",
  "copyField",
  "transformField",
  "updateRelatedRecord",
  "createRecord",
  "deleteRecord",
  "archiveRecord",
  "addToList",
  "removeFromList",
  "updateListEntry",
  "sendWebhook",
  "condition",
  "loop",
]);

/**
 * HTTP methods for integrations
 */
export const HttpMethodSchema = z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]);

/**
 * Auth types for HTTP templates
 */
export const AuthTypeSchema = z.enum(["none", "bearer", "basic", "apiKey"]);

/**
 * Webhook handler types
 */
export const WebhookHandlerTypeSchema = z.enum(["createRecord", "triggerAction"]);

/**
 * Merge field strategies
 */
export const MergeStrategySchema = z.enum([
  "targetWins",
  "sourceWins",
  "union",
  "concat",
  "skip",
]);

/**
 * Workspace member roles
 */
export const MemberRoleSchema = z.enum(["owner", "admin", "member", "viewer"]);
