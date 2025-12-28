# Agent CRM - Code Review Issues

This document contains all issues identified during a comprehensive code review prior to open source release.

## Issues

### 1. ~~No Authorization Checks in Queries/Mutations~~ ✅ FIXED

### 2. ~~Actor ID Not Validated Against Workspace~~ ✅ FIXED

### 3. ~~SSRF Bypass via Template Variables~~ ✅ FIXED

### 4. ~~SSRF Bypass via IPv6 and Missing Hosts~~ ✅ FIXED

### 5. ~~Weak Random Number Generator for API Keys~~ ✅ NO LONGER RELEVANT

### 6. ~~API Key Expiration Not Enforced~~ ✅ NO LONGER RELEVANT

### 7. ~~Timing Attack on API Key Hash Comparison~~ ✅ NO LONGER RELEVANT

### 8. ~~Missing `addedBy` Field in Action List Entries~~ ✅ FIXED

### 9. ~~No Scope Enforcement in MCP Server~~ ✅ FIXED

### 10. ~~Search Function Loads All Records Into Memory~~ ✅ FIXED

### 11. ~~Cursor-Based Pagination Not Implemented~~ ✅ FIXED

### 12. ~~Session Fixation/Hijacking Risk~~ ✅ FIXED

### 13. ~~No Rate Limiting~~ ✅ FIXED

### 14. ~~Race Condition on Slug Uniqueness~~ ✅ FIXED

### 15. ~~Dockerfile References Wrong Lock File~~ ✅ FIXED

### 16. ~~Missing `baseUrl` in tsconfig.json~~ ✅ FIXED

### 17. ~~Type Coercion Vulnerabilities~~ ✅ FIXED

## Medium Severity Issues

### 18. ~~Missing Audit Logging for Security Operations~~ ✅ FIXED

### 19. ~~Information Disclosure in Error Messages~~ ✅ FIXED

### 20. ~~No `.env.example` File~~ ✅ FIXED

### 21. ~~No LICENSE File~~ ✅ FIXED

### 22. ~~Duplicate Dependencies~~ ✅ FIXED

### 23. ~~Docker Container Runs as Root~~ ✅ FIXED

### 24. ~~Extensive Use of `v.any()` in Schema~~ ⚠️ NO NEED TO FIX

### 25. ~~No Recursion Limit on Nested Loops~~ ✅ FIXED

### 26. ~~Hardcoded Fallback URL~~ ✅ FIXED

### 27. ~~CORS Credentials with Broad Origins~~ ✅ FIXED

### 28. ~~Missing Validation for List Entry Object Types~~ ✅ FIXED

### 29. ~~HTTP Template URL Allows Internal URLs (SSRF)~~ ✅ FIXED

### 30. ~~No Validation of Cron Schedule Format~~ ✅ FIXED

### 30b. ~~Action Triggers Not Fully Implemented~~ ✅ FIXED

Lifecycle triggers (`onCreate`, `onUpdate`, `onDelete`, `onFieldChange`, `onListAdd`, `onListRemove`) and scheduled triggers were defined in schema but had no execution path. Fixed by:
- Adding `convex/lib/triggers.ts` - trigger evaluation helper
- Adding `convex/lib/cron.ts` - cron expression parser
- Adding `convex/functions/actions/scheduled.ts` - scheduled action executor
- Adding `convex/crons.ts` - runs every minute to check scheduled actions
- Adding trigger hooks to record and list mutations
- Adding denormalized trigger fields + indexes for efficient queries

---

## Simplification Analysis

### Core Purpose
Agent CRM is a headless, MCP-first CRM for AI agents. Core requirements:
1. Dynamic schema management (object types, attributes at runtime)
2. Record CRUD with multi-tenant workspace isolation
3. Many-to-many relationships via lists with junction attributes
4. Composable automation actions (no user code execution)
5. HTTP integrations (incoming webhooks, outgoing templates)
6. OAuth 2.1 authentication as Resource Server

---

## Medium Severity Issues

### 31. ~~Duplicate HTTP Request Logic in httpActions.ts~~ ✅ FIXED

### 32. ~~Duplicate Workspace Listing Functions~~ ✅ FIXED

### 33. ~~Overly Long seedSystemObjectTypes Function~~ ✅ FIXED

Refactored to use data-driven seed definitions (`SEED_OBJECT_TYPES`, `SEED_REFERENCES`, `SEED_LISTS`) with iteration. Function reduced from ~315 lines to ~100 lines + ~130 lines of structured data. Much more readable and maintainable.

### 34. ~~Triplicated getNestedValue Helper~~ ✅ FIXED

Extracted to `convex/lib/interpolation.ts`. All three files now import the shared utility. Supports both string path and string array formats.

### 35. ~~triggerActionFromWebhook Creates Pending Execution Without Execution~~ ✅ FIXED

Fixed by requiring `recordId` and `actorId` in webhook payload. The handler now validates both, then calls the shared `executeInternal` mutation which runs all action steps. Breaking change: `triggerAction` webhooks must now include `recordId` and `actorId` in the JSON payload.

### 36. ~~createRecordFromWebhook Uses Arbitrary Workspace Member as Actor~~ ✅ FIXED

Now requires `actorId` in webhook payload for `createRecord` handlers. Breaking change: webhooks using `createRecord` must now include `actorId` in the JSON payload for proper attribution.

### 37. ~~Missing Index for httpRequestLogs Filtering~~ ✅ FIXED

Added `by_workspace_template` index to schema. Updated `getHttpRequestLogs` query to use appropriate index based on filter parameters (templateId, actionExecutionId, or workspace-only).

### 38. ~~N+1 Query Pattern in Audit Log Enrichment~~ ✅ FIXED

Refactored `getRecordHistory` to batch fetch members and users using Maps. Now makes 2 batched queries (unique members + unique users) instead of 2N queries.

---

## Low Severity Issues

### 39. ~~Unused validateScopes Function~~ ✅ FIXED

Removed unused `validateScopes` function from `mcp-server/src/auth/scopes.ts`.

### 40. ~~No Input Length Validation on Slugs/Names~~ ✅ FIXED

Added `validateCommonFields()` helper to `convex/lib/validation.ts` with length limits:
- `slug`: max 64 characters
- `name`: max 128 characters
- `description`: max 1000 characters

Applied to `objectTypes`, `attributes`, `lists`, and `actions` create mutations.

### 41. ~~MCP Server Tool Handlers Have Repetitive Boilerplate~~ ✅ FIXED

Added `jsonResponse()` helper function to reduce repetitive response formatting. Reduced server.ts from ~1200 lines to ~1077 lines (~120 lines saved).

### 42. ~~Console Statements in Production Code~~ ⚠️ ACCEPTABLE

Console statements are acceptable for open-source release. For production deployments, structured logging can be added as needed.

### 43. ~~Magic Numbers in Configuration~~ ✅ FIXED

Extracted to environment variables with sensible defaults:
- `SESSION_TTL_MINUTES` (default: 30)
- `SESSION_CLEANUP_MINUTES` (default: 5)
- `IP_RATE_LIMIT_PER_MINUTE` (default: 100)
- `USER_RATE_LIMIT_PER_MINUTE` (default: 300)

### 44. ~~Type Assertions with `as any`~~ ⚠️ ACCEPTABLE

Type assertions are necessary due to Convex's type generation patterns. The `as any` casts are primarily used for:
- Convex ID type conversions between string and `Id<"table">`
- Dynamic data structures in schema `v.any()` fields
- Query builder type inference limitations

These are safe patterns given Convex's runtime validation.

---

## YAGNI Considerations

### 45. Multiple OAuth Provider Support

**Location:** `mcp-server/src/auth/providers/`

**Analysis:** Supports WorkOS, PropelAuth, Auth0, and custom JWKS - but only one is used at runtime.

**Verdict:** Keep. This is intentional flexibility for different deployment environments. The abstraction is clean and each provider is ~30 lines.

### 46. Comprehensive SSRF Protection

**Location:** `mcp-server/src/lib/validation.ts:1-189`

**Analysis:** 189 lines of URL validation covering IPv4, IPv6, IPv6-mapped-IPv4, cloud metadata, etc.

**Verdict:** Keep. Security code should be thorough. Each blocked pattern addresses real attack vectors.
