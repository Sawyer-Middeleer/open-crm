# Agent CRM - Code Review Issues

This document contains all issues identified during a comprehensive code review prior to open source release.

---

## Table of Contents

- [Critical Issues](#critical-issues)
- [High Severity Issues](#high-severity-issues)
- [Medium Severity Issues](#medium-severity-issues)
- [Low Severity Issues](#low-severity-issues)
- [Testing Gaps](#testing-gaps)
- [Documentation Issues](#documentation-issues)
- [Architecture Concerns](#architecture-concerns)

---

## Critical Issues

These issues must be fixed before open source release.

### 1. ~~No Authorization Checks in Queries/Mutations~~ ✅ FIXED

### 2. ~~Actor ID Not Validated Against Workspace~~ ✅ FIXED

### 3. ~~SSRF Bypass via Template Variables~~ ✅ FIXED

### 4. ~~SSRF Bypass via IPv6 and Missing Hosts~~ ✅ FIXED

### 5. ~~Weak Random Number Generator for API Keys~~ ✅ NO LONGER RELEVANT

### 6. ~~API Key Expiration Not Enforced~~ ✅ NO LONGER RELEVANT

### 7. ~~Timing Attack on API Key Hash Comparison~~ ✅ NO LONGER RELEVANT

### 8. Missing `addedBy` Field in Action List Entries

**Location:** `convex/functions/actions/mutations.ts:454-466`

**Description:** When action steps add list entries, the required `addedBy` field is missing, violating the schema.

**Example:**
```typescript
const entryId = await ctx.db.insert("listEntries", {
  workspaceId: context.workspaceId as never,
  listId: listDoc._id,
  recordId: targetRecordId as never,
  parentRecordId: parentRecordId as never,
  data: data ?? {},
  createdAt: now,
  updatedAt: now,
  // MISSING: addedBy is required by schema!
});
```

**Recommendation:** Add `addedBy` field using the action executor's member ID.

---

### 9. No Scope Enforcement in MCP Server

**Location:** `mcp-server/src/server.ts:23-47`

**Description:** Scopes are extracted from authentication but never checked in tool handlers. All authenticated users can perform all operations regardless of assigned scopes.

**Recommendation:** Implement scope checking in each tool handler before executing operations.

---

## High Severity Issues

### 10. Search Function Loads All Records Into Memory

**Location:** `convex/functions/records/queries.ts:153-278`

**Description:** The `search` function uses `.collect()` which loads ALL matching records into memory before filtering. This will cause out-of-memory errors for workspaces with large numbers of records.

**Example:**
```typescript
records = await ctx.db
  .query("records")
  .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
  .collect();  // Unbounded! Could OOM
```

**Recommendation:** Implement server-side filtering with indexed queries and pagination.

---

### 11. Cursor-Based Pagination Not Implemented

**Location:** `convex/functions/records/queries.ts:32-76`

**Description:** The `list` function accepts a `cursor` parameter but never uses it in the handler.

**Recommendation:** Implement proper cursor-based pagination using Convex's pagination APIs.

---

### 12. Session Fixation/Hijacking Risk

**Location:** `mcp-server/src/http.ts:168-181`

**Description:** Authentication context can be updated for existing sessions, potentially allowing session hijacking.

**Example:**
```typescript
if (transport.sessionId) {
  const existingEntry = sessions.get(transport.sessionId);
  if (existingEntry) {
    existingEntry.auth = authContext;  // Auth can be overwritten!
  }
}
```

**Recommendation:** Generate new session IDs after authentication changes.

---

### 13. No Rate Limiting

**Location:** `mcp-server/src/http.ts`

**Description:** No rate limiting implemented anywhere in the server, exposing it to brute force attacks, DoS attacks, and enumeration attacks.

**Recommendation:** Implement per-IP and per-user rate limiting.

---

### 14. Race Condition on Slug Uniqueness

**Location:** Multiple files

**Description:** Slug duplicate checks have time-of-check-time-of-use (TOCTOU) race conditions. Convex doesn't have unique constraints, so concurrent writes can create duplicates.

**Affected Files:**
- `convex/functions/workspaces/mutations.ts:17-25`
- `convex/functions/objectTypes/mutations.ts:17-26`
- `convex/functions/actions/mutations.ts:922-931`

**Recommendation:** Use optimistic concurrency control or implement a reservation pattern.

---

### 15. Dockerfile References Wrong Lock File

**Location:** `Dockerfile:6`

**Description:** References `bun.lockb` but the actual file is `bun.lock`.

**Example:**
```dockerfile
COPY mcp-server/package.json mcp-server/bun.lockb ./
```

**Recommendation:** Change to `bun.lock`.

---

### 16. Missing `baseUrl` in tsconfig.json

**Location:** `tsconfig.json`

**Description:** Has `paths` configuration but missing required `baseUrl` for path mapping to work.

**Recommendation:** Add `"baseUrl": "."` to tsconfig.json.

---

### 17. Type Coercion Vulnerabilities

**Location:** `mcp-server/src/server.ts` (multiple locations)

**Description:** IDs are cast using `as any` without validation throughout the file, allowing injection of malformed IDs.

**Affected Lines:** 101, 152, 178, 262, 330, and many more.

**Recommendation:** Add ID format validation before using them in Convex queries.

---

## Medium Severity Issues

### 18. Missing Audit Logging for Security Operations

**Location:** Multiple files

**Description:** Several security-sensitive operations lack audit logging.

**Missing Audit Logs:**
- `convex/functions/workspaces/mutations.ts` - Workspace creation
- `convex/functions/workspaces/mutations.ts:373-416` - Member addition
- `convex/functions/auth/mutations.ts:138-233` - API key create/revoke
- `convex/functions/integrations/mutations.ts:99-323` - Webhook operations
- `convex/functions/integrations/mutations.ts:370-524` - HTTP template operations

**Recommendation:** Add audit logging for all security-sensitive operations.

---

### 19. Information Disclosure in Error Messages

**Location:** `mcp-server/src/http.ts:216-222`

**Description:** Internal error messages are directly exposed to clients.

**Example:**
```typescript
return createUnauthorizedResponse(
  error instanceof Error ? error.message : "Authentication failed",
  config.resourceUri
);
```

**Recommendation:** Return generic error messages to clients, log details server-side.

---

### 20. No `.env.example` File

**Location:** Project root

**Description:** No template for environment variables exists. Required variables are documented in CLAUDE.md but should have a proper example file.

**Recommendation:** Create `.env.example` with all required and optional variables.

---

### 21. No LICENSE File

**Location:** Project root

**Description:** Required for open source release. No license file currently exists.

**Recommendation:** Add appropriate open source license (MIT, Apache 2.0, etc.).

---

### 22. Duplicate Dependencies

**Location:** Root and `mcp-server/package.json`

**Description:** `convex` dependency exists in both package.json files, which could lead to version drift.

**Recommendation:** Use Bun workspaces or ensure versions are synchronized.

---

### 23. Docker Container Runs as Root

**Location:** `Dockerfile`

**Description:** No non-root user is created, container runs as root.

**Recommendation:** Add a non-root user and switch to it before CMD.

---

### 24. Extensive Use of `v.any()` in Schema

**Location:** `convex/schema.ts`

**Description:** Multiple fields use `v.any()` which bypasses schema validation.

**Affected Fields:**
- `records.data` (line 163)
- `attributes.defaultValue` (line 126)
- `listEntries.data` (line 265)
- `actions.steps[].config` (line 415)
- `views.config.filters[].value` (line 684)

**Recommendation:** Replace with proper validators where possible.

---

### 25. No Recursion Limit on Nested Loops

**Location:** `convex/functions/actions/mutations.ts:619-723`

**Description:** While there's a `maxIterations` limit (default 100), nested loops have no depth limit. Deeply nested loops could cause stack overflow.

**Recommendation:** Add a maximum nesting depth limit.

---

### 26. Hardcoded Fallback URL

**Location:** `mcp-server/src/http.ts:33-36`

**Description:** Uses `https://api.agent-crm.example` as fallback, which could be registered by an attacker.

**Recommendation:** Remove the fallback or use a domain you control.

---

### 27. CORS Credentials with Broad Origins

**Location:** `mcp-server/src/lib/validation.ts:87-91`

**Description:** When an origin is in the allowlist, credentials are allowed. Misconfiguration could enable credential theft.

**Recommendation:** Document CORS configuration carefully and validate origin patterns.

---

### 28. Missing Validation for List Entry Object Types

**Location:** `convex/functions/lists/mutations.ts:194-198`

**Description:** When adding a list entry, there's no check that the record's object type is in `allowedObjectTypeIds`.

**Recommendation:** Validate record's object type against list's allowed types.

---

### 29. ~~HTTP Template URL Allows Internal URLs (SSRF)~~ ✅ FIXED

Fixed by adding `validateUrlForFetch()` validation before all HTTP requests in `httpActions.ts`. The validation is called in:
- `sendHttpRequest` (internal action)
- `sendRequest` (public action)
- `sendFromTemplate` (after variable interpolation)

---

### 30. No Validation of Cron Schedule Format

**Location:** `convex/schema.ts:387`

**Description:** The `actions.trigger.schedule` field accepts any string without cron format validation.

**Recommendation:** Add cron expression validation.
