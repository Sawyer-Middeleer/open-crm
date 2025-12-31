# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Open CRM is a headless, MCP-first CRM built with Convex and Bun. The intended users are startups and agencies that use agentic systems (such as claude code or dedicated "AI SDRs") extensively in their work. Open CRM is designed to be used by AI agents as first-class users. This project is pre-release.

## Commands

```bash
# First-time setup (requires Convex account)
bunx convex dev          # Sets up Convex deployment and starts dev server

# Development
bun run dev              # Runs Convex dev server
bun run dev:mcp          # Runs HTTP MCP server on port 3000

# Production
bun run build            # Deploys to Convex production
```

## Architecture

### Stack
- **Convex** - Backend database + serverless functions
- **Bun** - Runtime for MCP server
- **TypeScript** - End-to-end type safety
- **@modelcontextprotocol/sdk** - MCP server implementation

### Directory Structure

```
/
├── convex/                     # Convex backend
│   ├── schema.ts               # Database schema (all tables)
│   ├── crons.ts                # Cron job definitions (scheduled actions)
│   ├── lib/                    # Shared utilities
│   │   ├── actionContext.ts    # Action execution context builder
│   │   ├── audit.ts            # Audit log helper
│   │   ├── auth.ts             # Authorization helper
│   │   ├── cron.ts             # Cron expression parser
│   │   ├── interpolation.ts    # Template variable interpolation
│   │   ├── seedWorkspace.ts    # Workspace seeding (object types, lists)
│   │   ├── triggers.ts         # Action trigger evaluation
│   │   ├── urlValidation.ts    # SSRF protection for HTTP requests
│   │   └── validation.ts       # Input validation helpers
│   └── functions/              # Convex functions
│       ├── workspaces/         # Workspace management + seeding
│       ├── objectTypes/        # Dynamic object type definitions
│       ├── attributes/         # Dynamic attribute definitions
│       ├── records/            # Record CRUD
│       ├── lists/              # Many-to-many lists
│       ├── actions/            # Composable automation actions
│       │   ├── mutations.ts    # Action CRUD + execution
│       │   ├── queries.ts      # Action queries
│       │   └── scheduled.ts    # Scheduled action executor
│       ├── auth/               # Auth queries and mutations
│       └── audit/              # Audit log queries
│
├── server/                     # HTTP + MCP server (Bun)
│   └── src/
│       ├── index.ts            # Entry point (starts HTTP server)
│       ├── http.ts             # HTTP server with auth middleware
│       ├── server.ts           # MCP server with all tools
│       ├── convex/client.ts    # Convex HTTP client
│       ├── lib/                # Server utilities
│       │   ├── rateLimiter.ts  # IP and user rate limiting
│       │   ├── validation.ts   # URL/SSRF validation
│       │   └── validators.ts   # Input validators
│       ├── auth/               # OAuth 2.1 Authentication
│       │   ├── types.ts        # AuthContext, AuthProvider interfaces
│       │   ├── manager.ts      # AuthManager orchestration
│       │   ├── config.ts       # Environment-based configuration
│       │   ├── scopes.ts       # Scope definitions and checking
│       │   ├── errors.ts       # RFC 6750 compliant error responses
│       │   ├── strategies/     # Auth strategies
│       │   │   └── oauth.ts    # Bearer token + JWKS validation
│       │   └── providers/      # OAuth provider configs
│       │       ├── workos.ts
│       │       ├── propelauth.ts
│       │       ├── auth0.ts
│       │       └── custom.ts
│       └── rest/               # REST API (Hono + OpenAPI)
│           ├── index.ts        # Hono app factory
│           ├── middleware/     # Auth, rate limiting, error handling
│           ├── routes/         # Route handlers (41 endpoints)
│           └── schemas/        # Shared Zod schemas
```

### Core Concepts

**Dynamic Schema**: Object types and attributes are defined at runtime in `objectTypes` and `attributes` tables. Standard objects (People, Companies, Deals) are seeded on workspace creation but fully modifiable.

**Records**: All data stored in single `records` table with `objectTypeId` discriminator. Attribute values in `data` field keyed by slug.

**Lists**: Many-to-many relationships with junction attributes. `lists` defines the relationship, `listEntries` holds the connections with their own `data`.

**Audit Trail**: Every mutation logs to `auditLogs` with before/after snapshots, actor, and timestamp.

**Actions**: Composable automations using predefined step types. No user code execution.

Trigger types:
- **Lifecycle**: `onCreate`, `onUpdate`, `onDelete`, `onFieldChange` (with watched fields)
- **List**: `onListAdd`, `onListRemove` (when records added/removed from lists)
- **Scheduled**: Cron-based execution with optional record filter conditions
- **Manual**: Triggered via `actions.execute` MCP tool

Step types:
- **Field ops**: `updateField`, `clearField`, `copyField`, `transformField`
- **Record ops**: `createRecord`, `deleteRecord`, `archiveRecord`
- **Related record ops**: `updateRelatedRecord` (update field on record via reference)
- **List ops**: `addToList`, `removeFromList`, `updateListEntry`
- **Control flow**: `condition` (if/else branches), `loop` (iterate over records/arrays)
- **External**: `sendWebhook`

Variable interpolation: `{{record.field}}`, `{{previous.output}}`, `{{loopItem}}`, `{{loopIndex}}`

### MCP Tools (41 total)

Record operations (14):
- `records.create`, `records.get`, `records.list`, `records.update`, `records.delete`
- `records.archive`, `records.restore` - Soft delete and restore
- `records.search` - Filter by field values with operators (equals, contains, greaterThan, etc.)
- `records.getRelated` - Traverse relationships (references + list memberships)
- `records.bulkValidate`, `records.bulkCommit`, `records.bulkInspect` - Bulk import workflow
- `records.bulkUpdate` - Update multiple records with same values
- `records.merge` - Merge source records into target

Schema management (4):
- `schema.objectTypes.list`, `schema.objectTypes.get`, `schema.objectTypes.create`
- `schema.attributes.create`

List operations (6):
- `lists.create` - Create custom many-to-many relationships with junction attributes
- `lists.getEntries`, `lists.addEntry`, `lists.removeEntry`
- `lists.bulkAddEntry`, `lists.bulkRemoveEntry` - Bulk list operations

Workspace (3):
- `workspace.create` - Self-service workspace creation (requires `crm:admin` scope)
- `workspace.updateMember`, `workspace.removeMember` - Member management

Actions (4):
- `actions.create` - Create automations with triggers, conditions, and 15 step types
- `actions.list`, `actions.execute`, `actions.delete`

Integrations (7):
- `integrations.createWebhookEndpoint`, `integrations.listWebhookEndpoints`, `integrations.getWebhookLogs`
- `integrations.createTemplate`, `integrations.listTemplates`, `integrations.sendRequest`, `integrations.getRequestLogs`

Users (2):
- `users.me` - Get current authenticated user and their workspaces
- `users.updatePreferences` - Update user preferences (timezone, default workspace)

Audit (1):
- `audit.getHistory`

### REST API (41 endpoints)

A RESTful HTTP API runs parallel to the MCP server at `/api/v1`, providing the same functionality for traditional integrations.

**Base URL**: `/api/v1`

**Documentation**:
- Swagger UI: `GET /api/v1/docs`
- OpenAPI Spec: `GET /api/v1/openapi.json`

**Endpoints by resource**:

| Resource | Endpoints | Description |
|----------|-----------|-------------|
| `/records` | 15 | CRUD, search, archive/restore, bulk ops, merge |
| `/schema/object-types` | 4 | Object type and attribute management |
| `/lists` | 6 | List CRUD and entry management |
| `/actions` | 4 | Action CRUD and execution |
| `/integrations` | 7 | Webhooks and HTTP templates |
| `/users` | 2 | Current user and preferences |
| `/workspaces` | 3 | Workspace and member management |

**Authentication**: Same OAuth 2.1 as MCP. Include JWT in `Authorization: Bearer <token>` header.

**Scopes**:
| Scope | Access |
|-------|--------|
| `crm:read` | GET endpoints |
| `crm:write` | GET + POST/PATCH/DELETE |
| `crm:admin` | Full access including workspace management |

**Rate Limiting**:
- IP-based: 100 requests/minute (before auth)
- User-based: 300 requests/minute (after auth)

**Error Format** (RFC 6750):
```json
{"error": "not_found", "message": "Record not found"}
```

## Environment Variables

Required in `.env`:
```
CONVEX_URL=https://your-deployment.convex.cloud
```

Optional:
```bash
MCP_RESOURCE_URI=https://api.open-crm.example/mcp  # For OAuth protected resource metadata
PORT=3000                                           # HTTP server port
HOSTNAME=0.0.0.0                                    # HTTP server hostname
CORS_ALLOWED_ORIGINS=https://app.example.com        # Comma-separated allowed origins

# Session management
SESSION_TTL_MINUTES=30                              # Session timeout (default: 30)
SESSION_CLEANUP_MINUTES=5                           # Cleanup interval (default: 5)

# Rate limiting (requests per minute)
IP_RATE_LIMIT_PER_MINUTE=100                        # Per-IP limit (default: 100)
USER_RATE_LIMIT_PER_MINUTE=300                      # Per-user limit (default: 300)

# Onboarding
DISABLE_AUTO_WORKSPACE=true                         # Disable auto-workspace creation (default: false)
```

## Authentication (OAuth 2.1)

The MCP server implements OAuth 2.1 as a Resource Server (RFC 9728 compliant). It validates JWT tokens but does not issue them - users authenticate with an external OAuth provider.

### OAuth Provider Setup

Choose one OAuth provider and complete both the **provider dashboard setup** and **MCP server configuration**.

#### PropelAuth

**Dashboard Setup** ([docs.propelauth.com](https://docs.propelauth.com)):
1. Create a PropelAuth project at [propelauth.com](https://propelauth.com)
2. Go to **OAuth Config** in your PropelAuth dashboard
3. Create an OAuth client:
   - Note the **Client ID** and **Client Secret**
   - Add redirect URI: `https://your-mcp-client.example/callback` (depends on your MCP client)
4. Configure allowed scopes (include `email`, `openid`, `profile`)
5. Note your **Auth URL** (e.g., `https://auth.yourproject.propelauthtest.com`)

**MCP Server `.env`:**
```bash
MCP_AUTH_PROVIDER=propelauth
PROPELAUTH_AUTH_URL=https://auth.yourproject.propelauthtest.com
```

**Token claims**: PropelAuth uses `org_id` for workspace ID (mapped automatically).

#### WorkOS

**Dashboard Setup** ([workos.com/docs](https://workos.com/docs)):
1. Create a WorkOS account at [workos.com](https://workos.com)
2. Go to **Configuration** → **OAuth**
3. Create an OAuth application:
   - Note the **Client ID**
   - Add redirect URI: `https://your-mcp-client.example/callback`
4. Go to **API Keys** and create an API key (optional, for management APIs)
5. Configure SSO connections if using enterprise SSO

**MCP Server `.env`:**
```bash
MCP_AUTH_PROVIDER=workos
WORKOS_CLIENT_ID=client_01HXXXXXX
```

**JWKS endpoint**: `https://api.workos.com/sso/jwks/{client_id}` (automatic)

#### Auth0

**Dashboard Setup** ([auth0.com/docs](https://auth0.com/docs)):
1. Create an Auth0 tenant at [auth0.com](https://auth0.com)
2. Go to **Applications** → **APIs** → **Create API**:
   - Name: `Open CRM API`
   - Identifier (audience): `https://api.open-crm.example` (your choice)
   - Signing algorithm: RS256
3. Go to **Applications** → **Applications** → **Create Application**:
   - For interactive users: **Regular Web Application** or **Single Page Application**
   - For M2M/agents: **Machine to Machine** (select the API created above)
   - Note the **Client ID** and **Client Secret**
   - Add callback URLs for your MCP client
4. Configure scopes in your API settings (add `crm:read`, `crm:write`, `crm:admin`)

**MCP Server `.env`:**
```bash
MCP_AUTH_PROVIDER=auth0
AUTH0_DOMAIN=your-tenant.auth0.com
AUTH0_AUDIENCE=https://api.open-crm.example  # Must match API identifier
```

**M2M token request** (for agents):
```bash
curl -X POST "https://your-tenant.auth0.com/oauth/token" \
  -H "Content-Type: application/json" \
  -d '{
    "client_id": "YOUR_CLIENT_ID",
    "client_secret": "YOUR_CLIENT_SECRET",
    "audience": "https://api.open-crm.example",
    "grant_type": "client_credentials",
    "scope": "crm:write"
  }'
```

#### Custom JWKS (Any OIDC Provider)

For any OAuth provider that supports OIDC/JWKS:

**MCP Server `.env`:**
```bash
MCP_AUTH_PROVIDER=custom
OAUTH_ISSUER=https://your-idp.com
OAUTH_JWKS_URI=https://your-idp.com/.well-known/jwks.json
OAUTH_AUDIENCE=https://api.open-crm.example  # Optional
```

The MCP server will validate tokens using the JWKS endpoint and verify the issuer claim.

### Request Format

```
Authorization: Bearer <jwt>
X-Workspace-Id: <workspace_id>    # Optional if token contains workspace claim
```

### Workspace ID

The workspace ID can be provided via:
1. **Token claim** (for M2M clients): `workspace_id`, `org_id` (PropelAuth), or `https://open-crm/workspace_id`
2. **Header** (for interactive users): `X-Workspace-Id`

Token claims take precedence over headers.

### Auto-Workspace Creation

When a new user authenticates for the first time and has no workspace memberships, a default workspace is automatically created:
- **Name**: `"{user's name}'s Workspace"` or `"{email prefix}'s Workspace"`
- **Slug**: `{email_prefix}-{random_6_chars}` (e.g., `alice-x7k9m2`)
- **Role**: User becomes the workspace owner
- **Seeding**: Default object types (People, Companies, Deals) are automatically created

This behavior can be disabled by setting `DISABLE_AUTO_WORKSPACE=true`, in which case new users without workspaces will receive a 400 error requiring manual workspace provisioning.

### Scopes

Coarse-grained scopes control access to tools:

| Scope | Description | Tools |
|-------|-------------|-------|
| `crm:read` | Read-only access | `*.get`, `*.list`, `*.search`, `audit.*`, `users.me` |
| `crm:write` | Read + write access | All `crm:read` tools + `*.create`, `*.update`, `*.delete`, `actions.execute` |
| `crm:admin` | Full access | All tools including `workspace.create` |

Scope hierarchy: `crm:admin` > `crm:write` > `crm:read`

### Protected Resource Metadata

The server exposes RFC 9728 metadata at:
```
GET /.well-known/oauth-protected-resource
```

Response includes supported scopes, bearer methods, and authorization server hints.

### Error Responses (RFC 6750)

- **401 Unauthorized**: Missing or invalid token. Includes `WWW-Authenticate` header with `error="invalid_token"`.
- **403 Forbidden (insufficient_scope)**: Valid token but missing required scope. Includes `scope` parameter in `WWW-Authenticate`.
- **403 Forbidden**: Workspace access denied.

## Multi-Tenancy

All data is scoped by `workspaceId`. Every table has workspace indexes. Users can belong to multiple workspaces with different roles (owner, admin, member, viewer).

