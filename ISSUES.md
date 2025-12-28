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

### 39. Unused validateScopes Function

**Location:** `mcp-server/src/auth/scopes.ts:108-118`

**Problem:** `validateScopes` is exported but never called anywhere in the codebase.

**Recommendation:** Remove or use for better error messages when invalid scopes are detected.

### 40. No Input Length Validation on Slugs/Names

**Location:** Throughout mutations - `objectTypes`, `attributes`, `lists`, `actions`, etc.

**Problem:** String fields like `slug`, `name`, `description` accept any length. Could lead to:
- Storage bloat with very long strings
- Display issues in clients
- Potential DoS via large payloads

**Recommendation:** Add length limits:
- `slug`: max 64 characters
- `name`: max 128 characters
- `description`: max 1000 characters

### 41. MCP Server Tool Handlers Have Repetitive Boilerplate

**Location:** `mcp-server/src/server.ts` (entire file)

**Problem:** 32 tools with nearly identical patterns:
```typescript
server.tool("tool.name", "description", { ...schema },
  async (args, extra) => {
    const auth = getAuthContext(extra, "tool.name");
    const result = await convex.query/mutation(...);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
    };
  }
);
```

**Impact:** ~1200 lines of code with significant repetition.

**Recommendation:** Create a helper factory:
```typescript
function registerTool(name, description, schema, handler) {
  server.tool(name, description, schema, async (args, extra) => {
    const auth = getAuthContext(extra, name);
    const result = await handler(auth, args);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  });
}
```

**Estimated LOC reduction:** ~300 lines

### 42. Console Statements in Production Code

**Location:**
- `mcp-server/src/http.ts:155-159, 202-203, 274, 328`
- `mcp-server/src/auth/manager.ts:42`
- `mcp-server/src/auth/factory.ts:17, 23`

**Problem:** Using `console.log/warn` instead of structured logging.

**Recommendation:** For open source, this is acceptable. For production, recommend structured logging with levels.

### 43. Magic Numbers in Configuration

**Location:**
- `mcp-server/src/http.ts:22-23` - Session TTL 30min, cleanup 5min
- `mcp-server/src/lib/rateLimiter.ts:90-93` - 100/300 requests per minute

**Recommendation:** Extract to environment variables or config file for easier tuning.

### 44. Type Assertions with `as any`

**Location:** Throughout codebase (30+ occurrences)

**Problem:** Type assertions bypass TypeScript safety:
- `as any` for Convex IDs
- `as any` for dynamic data
- `as Id<"table">` casts

**Context:** Many are necessary due to Convex's type generation. Not a bug, but reduces type safety.

**Recommendation:** Document why each `as any` is needed, or create typed wrapper functions.

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
