# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Agent CRM is a headless, MCP-first CRM built with Convex and Bun. The intended users are startups and agencies that use agentic systems (such as claude code or dedicated "AI SDRs") extensively in their work. Agent CRM is designed to be used by AI agents as first-class users. This project is pre-release.

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
├── mcp-server/                 # HTTP MCP server (Bun)
│   └── src/
│       ├── index.ts            # Entry point (starts HTTP server)
│       ├── http.ts             # HTTP server with auth middleware
│       ├── server.ts           # MCP server with all tools
│       ├── convex/client.ts    # Convex HTTP client
│       ├── lib/                # Server utilities
│       │   ├── rateLimiter.ts  # IP and user rate limiting
│       │   ├── validation.ts   # URL/SSRF validation
│       │   └── validators.ts   # Input validators
│       └── auth/               # OAuth 2.1 Authentication
│           ├── types.ts        # AuthContext, AuthProvider interfaces
│           ├── manager.ts      # AuthManager orchestration
│           ├── config.ts       # Environment-based configuration
│           ├── scopes.ts       # Scope definitions and checking
│           ├── errors.ts       # RFC 6750 compliant error responses
│           ├── strategies/     # Auth strategies
│           │   └── oauth.ts    # Bearer token + JWKS validation
│           └── providers/      # OAuth provider configs
│               ├── workos.ts
│               ├── propelauth.ts
│               ├── auth0.ts
│               └── custom.ts
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

### MCP Tools (32 total)

Record operations:
- `records.create`, `records.get`, `records.list`, `records.update`, `records.delete`
- `records.search` - Filter by field values with operators (equals, contains, greaterThan, etc.)
- `records.getRelated` - Traverse relationships (references + list memberships)

Bulk import:
- `records.bulkValidate` - Validate records, returns token-efficient summary + session ID
- `records.bulkCommit` - Insert valid records from session
- `records.bulkInspect` - Inspect specific records from validation session

Schema management:
- `schema.objectTypes.list`, `schema.objectTypes.get`, `schema.objectTypes.create`
- `schema.attributes.create`

List operations:
- `lists.create` - Create custom many-to-many relationships with junction attributes
- `lists.getEntries`, `lists.addEntry`, `lists.removeEntry`

Workspace:
- `workspace.create` - Self-service workspace creation via MCP (requires `crm:admin` scope)

Actions:
- `actions.create` - Create automations with triggers, conditions, and 15 step types
- `actions.list`, `actions.execute`

Integrations:
- `integrations.createWebhookEndpoint`, `integrations.listWebhookEndpoints`, `integrations.getWebhookLogs`
- `integrations.createTemplate`, `integrations.listTemplates`, `integrations.sendRequest`, `integrations.getRequestLogs`

Users:
- `users.me` - Get current authenticated user and their workspaces
- `users.updatePreferences` - Update user preferences (timezone, default workspace)

Audit:
- `audit.getHistory`

## Environment Variables

Required in `.env`:
```
CONVEX_URL=https://your-deployment.convex.cloud
```

Optional:
```bash
MCP_RESOURCE_URI=https://api.agent-crm.example/mcp  # For OAuth protected resource metadata
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
   - Name: `Agent CRM API`
   - Identifier (audience): `https://api.agent-crm.example` (your choice)
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
AUTH0_AUDIENCE=https://api.agent-crm.example  # Must match API identifier
```

**M2M token request** (for agents):
```bash
curl -X POST "https://your-tenant.auth0.com/oauth/token" \
  -H "Content-Type: application/json" \
  -d '{
    "client_id": "YOUR_CLIENT_ID",
    "client_secret": "YOUR_CLIENT_SECRET",
    "audience": "https://api.agent-crm.example",
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
OAUTH_AUDIENCE=https://api.agent-crm.example  # Optional
```

The MCP server will validate tokens using the JWKS endpoint and verify the issuer claim.

### Request Format

```
Authorization: Bearer <jwt>
X-Workspace-Id: <workspace_id>    # Optional if token contains workspace claim
```

### Workspace ID

The workspace ID can be provided via:
1. **Token claim** (for M2M clients): `workspace_id`, `org_id` (PropelAuth), or `https://agent-crm/workspace_id`
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

## Architectural Diagrams

### High-Level System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              EXTERNAL CLIENTS                                    │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐ │
│  │   Claude    │  │   AI SDR    │  │  Custom     │  │  External Webhooks      │ │
│  │   Code      │  │   Agent     │  │  MCP Client │  │  (Stripe, Hubspot, etc) │ │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └───────────┬─────────────┘ │
└─────────┼────────────────┼────────────────┼─────────────────────┼───────────────┘
          │                │                │                     │
          │ MCP Protocol   │                │                     │ HTTP POST
          │ (JSON-RPC)     │                │                     │
          ▼                ▼                ▼                     ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         MCP SERVER (Bun Runtime)                                 │
│  ┌────────────────────────────────────────────────────────────────────────────┐ │
│  │                        HTTP Layer (mcp-server/src/http.ts)                 │ │
│  │  ┌─────────────┐  ┌─────────────┐  ┌──────────────┐  ┌──────────────────┐  │ │
│  │  │ CORS        │  │ Rate        │  │ Session      │  │ RFC 9728         │  │ │
│  │  │ Middleware  │  │ Limiter     │  │ Management   │  │ Discovery        │  │ │
│  │  └─────────────┘  └─────────────┘  └──────────────┘  └──────────────────┘  │ │
│  └────────────────────────────────────────────────────────────────────────────┘ │
│                                      │                                           │
│                                      ▼                                           │
│  ┌────────────────────────────────────────────────────────────────────────────┐ │
│  │                     Auth Layer (mcp-server/src/auth/)                      │ │
│  │  ┌──────────────────────────────────────────────────────────────────────┐  │ │
│  │  │  AuthManager → OAuthStrategy → JWKS Validation → Scope Enforcement   │  │ │
│  │  └──────────────────────────────────────────────────────────────────────┘  │ │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐    │ │
│  │  │ Auth0       │  │ WorkOS      │  │ PropelAuth  │  │ Custom OIDC     │    │ │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────────┘    │ │
│  └────────────────────────────────────────────────────────────────────────────┘ │
│                                      │                                           │
│                                      ▼                                           │
│  ┌────────────────────────────────────────────────────────────────────────────┐ │
│  │                 MCP Server (mcp-server/src/server.ts)                      │ │
│  │                          32 Tools in 7 Categories                          │ │
│  │  ┌────────────┐ ┌──────────┐ ┌────────┐ ┌─────────┐ ┌─────────────────┐   │ │
│  │  │ Records    │ │ Schema   │ │ Lists  │ │ Actions │ │ Integrations    │   │ │
│  │  │ (11 tools) │ │ (4)      │ │ (5)    │ │ (4)     │ │ (7 tools)       │   │ │
│  │  └────────────┘ └──────────┘ └────────┘ └─────────┘ └─────────────────┘   │ │
│  └────────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       │ Convex HTTP Client
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           CONVEX BACKEND                                         │
│  ┌────────────────────────────────────────────────────────────────────────────┐ │
│  │                    Functions (convex/functions/)                           │ │
│  │  ┌─────────────────────────────────────────────────────────────────────┐   │ │
│  │  │                         Mutations                                    │   │ │
│  │  │  records/   objectTypes/   lists/   actions/   integrations/        │   │ │
│  │  │  mutations  mutations      mutations mutations httpActions           │   │ │
│  │  └─────────────────────────────────────────────────────────────────────┘   │ │
│  │  ┌─────────────────────────────────────────────────────────────────────┐   │ │
│  │  │                          Queries                                     │   │ │
│  │  │  records/   objectTypes/   lists/   actions/   audit/               │   │ │
│  │  │  queries    queries        queries  queries    queries              │   │ │
│  │  └─────────────────────────────────────────────────────────────────────┘   │ │
│  └────────────────────────────────────────────────────────────────────────────┘ │
│                                      │                                           │
│  ┌────────────────────────────────────────────────────────────────────────────┐ │
│  │                      Shared Libraries (convex/lib/)                        │ │
│  │  ┌──────────┐ ┌──────────┐ ┌────────────┐ ┌────────────┐ ┌──────────────┐  │ │
│  │  │ auth.ts  │ │ audit.ts │ │ triggers.ts│ │ action     │ │ interpolation│  │ │
│  │  │          │ │          │ │            │ │ Context.ts │ │ .ts          │  │ │
│  │  └──────────┘ └──────────┘ └────────────┘ └────────────┘ └──────────────┘  │ │
│  └────────────────────────────────────────────────────────────────────────────┘ │
│                                      │                                           │
│  ┌────────────────────────────────────────────────────────────────────────────┐ │
│  │                      Database (convex/schema.ts)                           │ │
│  │                          16 Tables                                         │ │
│  │  ┌──────────────────────────────────────────────────────────────────────┐  │ │
│  │  │ Multi-Tenancy    │ Dynamic Schema    │ Core Data                     │  │ │
│  │  │ ─────────────    │ ──────────────    │ ─────────                     │  │ │
│  │  │ • workspaces     │ • objectTypes     │ • records                     │  │ │
│  │  │ • workspaceMembers│ • attributes      │ • bulkValidationSessions     │  │ │
│  │  │ • users          │                   │                               │  │ │
│  │  ├──────────────────────────────────────────────────────────────────────┤  │ │
│  │  │ Lists            │ Automations       │ Integrations    │ Audit       │  │ │
│  │  │ ─────            │ ───────────       │ ────────────    │ ─────       │  │ │
│  │  │ • lists          │ • actions         │ • incomingWebhooks │ • auditLogs │ │
│  │  │ • listAttributes │ • actionExecutions│ • webhookLogs   │             │  │ │
│  │  │ • listEntries    │                   │ • httpTemplates │             │  │ │
│  │  │                  │                   │ • httpRequestLogs│            │  │ │
│  │  └──────────────────────────────────────────────────────────────────────┘  │ │
│  └────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                  │
│  ┌────────────────────────────────────────────────────────────────────────────┐ │
│  │                     Cron Jobs (convex/crons.ts)                            │ │
│  │                   Scheduled Action Executor (every minute)                 │ │
│  └────────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Authentication Flow

```
┌────────────────┐
│  MCP Client    │
│  (AI Agent)    │
└───────┬────────┘
        │ Authorization: Bearer <JWT>
        │ X-Workspace-Id: <optional>
        ▼
┌───────────────────────────────────────────────────────────────────────────────┐
│                              HTTP MIDDLEWARE                                   │
│  ┌─────────────────────────────────────────────────────────────────────────┐  │
│  │ 1. Extract Bearer token from Authorization header                        │  │
│  └─────────────────────────────────────────────────────────────────────────┘  │
│                                   │                                            │
│                                   ▼                                            │
│  ┌─────────────────────────────────────────────────────────────────────────┐  │
│  │ 2. AuthManager.authenticate()                                            │  │
│  │    ├─ Try each provider in priority order                                │  │
│  │    └─ OAuthStrategy.authenticate()                                       │  │
│  │       ├─ Fetch JWKS from provider endpoint                               │  │
│  │       ├─ Validate JWT signature (jose library)                           │  │
│  │       ├─ Verify: issuer, audience, expiration                            │  │
│  │       └─ Extract claims: sub, email, scope                               │  │
│  └─────────────────────────────────────────────────────────────────────────┘  │
│                                   │                                            │
│                                   ▼                                            │
│  ┌─────────────────────────────────────────────────────────────────────────┐  │
│  │ 3. Resolve Workspace ID                                                  │  │
│  │    Priority: token.workspace_id → token.org_id → X-Workspace-Id header   │  │
│  └─────────────────────────────────────────────────────────────────────────┘  │
│                                   │                                            │
│                                   ▼                                            │
│  ┌─────────────────────────────────────────────────────────────────────────┐  │
│  │ 4. Get or Create User (Convex mutation)                                  │  │
│  │    ├─ Query users by [authProvider, authProviderId]                      │  │
│  │    ├─ If new user & no workspace → auto-create workspace                 │  │
│  │    └─ Return { userId, workspaceMemberId, role }                         │  │
│  └─────────────────────────────────────────────────────────────────────────┘  │
│                                   │                                            │
│                                   ▼                                            │
│  ┌─────────────────────────────────────────────────────────────────────────┐  │
│  │ 5. Build AuthContext                                                     │  │
│  │    { userId, email, workspaceId, workspaceMemberId, role, scopes }       │  │
│  └─────────────────────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌───────────────────────────────────────────────────────────────────────────────┐
│                             TOOL EXECUTION                                     │
│  ┌─────────────────────────────────────────────────────────────────────────┐  │
│  │ 6. Check scope requirement                                               │  │
│  │    ├─ crm:read  → read-only tools                                        │  │
│  │    ├─ crm:write → read + write tools                                     │  │
│  │    └─ crm:admin → all tools (including workspace.create)                 │  │
│  │                                                                          │  │
│  │    Hierarchy: crm:admin > crm:write > crm:read                           │  │
│  └─────────────────────────────────────────────────────────────────────────┘  │
│                                   │                                            │
│                                   ▼                                            │
│  ┌─────────────────────────────────────────────────────────────────────────┐  │
│  │ 7. Execute Convex function with workspace-scoped query                   │  │
│  │    └─ All queries include WHERE workspaceId = ctx.workspaceId            │  │
│  └─────────────────────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────────────────────┘
```

### Record CRUD Flow

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              records.create                                      │
└─────────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│ 1. Validate Auth Context (scope: crm:write)                                     │
└─────────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│ 2. Resolve Object Type by slug                                                  │
│    └─ Query objectTypes WHERE workspaceId AND slug                              │
└─────────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│ 3. Validate Record Data                                                         │
│    ├─ Fetch all attributes for object type                                      │
│    ├─ Check required fields                                                     │
│    ├─ Validate types (text, number, email, etc.)                                │
│    └─ Check unique constraints (skip archived records)                          │
└─────────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│ 4. Compute displayName from primaryAttribute                                    │
└─────────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│ 5. Insert Record                                                                │
│    └─ ctx.db.insert("records", { workspaceId, objectTypeId, data, displayName })│
└─────────────────────────────────────────────────────────────────────────────────┘
                                      │
                          ┌───────────┴───────────┐
                          ▼                       ▼
┌─────────────────────────────────────┐  ┌────────────────────────────────────────┐
│ 6a. Create Audit Log                │  │ 6b. Evaluate Triggers (async)          │
│     action: "create"                │  │     ├─ Find actions WHERE              │
│     afterSnapshot: record data      │  │     │   triggerType = "onCreate"       │
└─────────────────────────────────────┘  │     │   AND objectTypeId matches       │
                                         │     ├─ Evaluate conditions             │
                                         │     └─ ctx.scheduler.runAfter(0,       │
                                         │        executeInternal)                │
                                         └────────────────────────────────────────┘
                          │                       │
                          └───────────┬───────────┘
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│ 7. Return { recordId, record }                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Action Execution Flow

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           TRIGGER SOURCES                                        │
│                                                                                  │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐                   │
│  │ Lifecycle       │  │ List Events     │  │ Scheduled       │                   │
│  │ ─────────       │  │ ───────────     │  │ ─────────       │                   │
│  │ • onCreate      │  │ • onListAdd     │  │ Cron expression │                   │
│  │ • onUpdate      │  │ • onListRemove  │  │ (every minute)  │                   │
│  │ • onDelete      │  │                 │  │                 │                   │
│  │ • onFieldChange │  │                 │  │                 │                   │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘                   │
│           │                    │                    │                            │
│           │ Record mutation    │ List mutation      │ crons.ts                   │
│           ▼                    ▼                    ▼                            │
│  ┌─────────────────────────────────────────────────────────────────────────────┐│
│  │                        evaluateTriggers()                                   ││
│  │  ├─ Find matching actions by [by_trigger_object] or [by_trigger_list]       ││
│  │  ├─ Filter: workspaceId, isActive, triggerType                              ││
│  │  └─ Evaluate conditions against record data                                 ││
│  └─────────────────────────────────────────────────────────────────────────────┘│
│                                   │                                              │
│           Manual trigger          │                                              │
│           ───────────────         │                                              │
│  ┌─────────────────┐              │                                              │
│  │ actions.execute │──────────────┤                                              │
│  │ MCP tool        │              │                                              │
│  └─────────────────┘              │                                              │
└───────────────────────────────────┼──────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                        executeInternal()                                         │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────────┐│
│  │ 1. Create actionExecution record                                            ││
│  │    { actionId, recordId, status: "running", triggeredBy, startedAt }        ││
│  └─────────────────────────────────────────────────────────────────────────────┘│
│                                    │                                             │
│                                    ▼                                             │
│  ┌─────────────────────────────────────────────────────────────────────────────┐│
│  │ 2. Initialize StepContext                                                   ││
│  │    { workspaceId, actorId, record, previousStepOutput, variables }          ││
│  └─────────────────────────────────────────────────────────────────────────────┘│
│                                    │                                             │
│                                    ▼                                             │
│  ┌─────────────────────────────────────────────────────────────────────────────┐│
│  │ 3. FOR EACH step IN action.steps:                                           ││
│  │    ┌─────────────────────────────────────────────────────────────────────┐  ││
│  │    │ a. Interpolate config                                               │  ││
│  │    │    {{record.field}} → record.data[field]                            │  ││
│  │    │    {{previous.output}} → last step result                           │  ││
│  │    │    {{loopItem}} / {{loopIndex}} → loop context                      │  ││
│  │    └─────────────────────────────────────────────────────────────────────┘  ││
│  │                              │                                               ││
│  │                              ▼                                               ││
│  │    ┌─────────────────────────────────────────────────────────────────────┐  ││
│  │    │ b. Execute step by type                                             │  ││
│  │    │                                                                     │  ││
│  │    │    FIELD OPS         RECORD OPS        LIST OPS       CONTROL FLOW  │  ││
│  │    │    ─────────         ──────────        ────────       ────────────  │  ││
│  │    │    updateField       createRecord      addToList      condition     │  ││
│  │    │    clearField        deleteRecord      removeFromList loop          │  ││
│  │    │    copyField         archiveRecord     updateListEntry              │  ││
│  │    │    transformField    restoreRecord                                  │  ││
│  │    │    updateRelatedRecord                               EXTERNAL       │  ││
│  │    │                                                      ────────       │  ││
│  │    │                                                      sendWebhook    │  ││
│  │    └─────────────────────────────────────────────────────────────────────┘  ││
│  │                              │                                               ││
│  │                              ▼                                               ││
│  │    ┌─────────────────────────────────────────────────────────────────────┐  ││
│  │    │ c. Record step result                                               │  ││
│  │    │    { stepId, status, startedAt, completedAt, input, output, error } │  ││
│  │    └─────────────────────────────────────────────────────────────────────┘  ││
│  │                              │                                               ││
│  │                    ┌─────────┴─────────┐                                     ││
│  │                    ▼                   ▼                                     ││
│  │            [success]            [failure]                                    ││
│  │            Continue to          Break loop                                   ││
│  │            next step            Mark as failed                               ││
│  └─────────────────────────────────────────────────────────────────────────────┘│
│                                    │                                             │
│                                    ▼                                             │
│  ┌─────────────────────────────────────────────────────────────────────────────┐│
│  │ 4. Finalize execution                                                       ││
│  │    ctx.db.patch(executionId, { status, completedAt, stepResults })          ││
│  │    createAuditLog({ action: "action_executed", metadata })                  ││
│  └─────────────────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Multi-Tenancy Structure

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              WORKSPACE ISOLATION                                 │
│                                                                                  │
│  ┌───────────────────────────────────────────────────────────────────────────┐  │
│  │                            workspace                                       │  │
│  │                     { name, slug, settings }                               │  │
│  └───────────────────────────────────────────────────────────────────────────┘  │
│                                     │                                            │
│            ┌────────────────────────┼────────────────────────┐                   │
│            │                        │                        │                   │
│            ▼                        ▼                        ▼                   │
│  ┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐           │
│  │ workspaceMembers │    │ objectTypes      │    │ lists            │           │
│  │ (User → Role)    │    │ (Schema)         │    │ (Relationships)  │           │
│  │                  │    │                  │    │                  │           │
│  │ • owner          │    │ • People         │    │ • listAttributes │           │
│  │ • admin          │    │ • Companies      │    │ • listEntries    │           │
│  │ • member         │    │ • Deals          │    │                  │           │
│  │ • viewer         │    │ • Custom...      │    │                  │           │
│  └──────────────────┘    └────────┬─────────┘    └──────────────────┘           │
│                                   │                                              │
│                                   ▼                                              │
│                        ┌──────────────────┐                                      │
│                        │ attributes       │                                      │
│                        │ (16 types)       │                                      │
│                        │                  │                                      │
│                        │ text, number,    │                                      │
│                        │ email, phone,    │                                      │
│                        │ reference, etc.  │                                      │
│                        └────────┬─────────┘                                      │
│                                 │                                                │
│                                 ▼                                                │
│  ┌───────────────────────────────────────────────────────────────────────────┐  │
│  │                           records                                          │  │
│  │               (All data in single table, keyed by objectTypeId)            │  │
│  │                                                                            │  │
│  │   { _id, workspaceId, objectTypeId, data: { [slug]: value }, displayName } │  │
│  └───────────────────────────────────────────────────────────────────────────┘  │
│                                     │                                            │
│            ┌────────────────────────┼────────────────────────┐                   │
│            │                        │                        │                   │
│            ▼                        ▼                        ▼                   │
│  ┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐           │
│  │ actions          │    │ auditLogs        │    │ integrations     │           │
│  │ (Automations)    │    │ (Immutable)      │    │                  │           │
│  │                  │    │                  │    │ • webhooks       │           │
│  │ • actionExec.    │    │ • before/after   │    │ • httpTemplates  │           │
│  │ • triggers       │    │ • actor          │    │ • logs           │           │
│  │ • steps          │    │ • timestamp      │    │                  │           │
│  └──────────────────┘    └──────────────────┘    └──────────────────┘           │
│                                                                                  │
│  ┌───────────────────────────────────────────────────────────────────────────┐  │
│  │                    EVERY TABLE HAS:                                        │  │
│  │    • workspaceId field                                                     │  │
│  │    • Index: by_workspace or by_workspace_*                                 │  │
│  │    • All queries filtered by authenticated workspaceId                     │  │
│  └───────────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Webhook Integration Flow

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                        INCOMING WEBHOOKS                                         │
│                                                                                  │
│  External Service (Stripe, etc.)                                                 │
│           │                                                                      │
│           │ POST /webhooks/{workspaceId}/{slug}                                  │
│           │ X-Webhook-Signature: <hmac>                                          │
│           │ Body: { ...payload }                                                 │
│           ▼                                                                      │
│  ┌─────────────────────────────────────────────────────────────────────────────┐│
│  │ convex/http.ts                                                              ││
│  │  ├─ Lookup webhook by [workspaceId, slug]                                   ││
│  │  ├─ Verify HMAC signature (if configured)                                   ││
│  │  └─ Check webhook.isActive                                                  ││
│  └─────────────────────────────────────────────────────────────────────────────┘│
│                          │                                                       │
│              ┌───────────┴───────────┐                                           │
│              ▼                       ▼                                           │
│  ┌────────────────────┐  ┌────────────────────┐                                  │
│  │ handler:           │  │ handler:           │                                  │
│  │ createRecord       │  │ triggerAction      │                                  │
│  │                    │  │                    │                                  │
│  │ Use fieldMapping   │  │ Execute action     │                                  │
│  │ to map payload     │  │ with recordId      │                                  │
│  │ to record fields   │  │ from payload       │                                  │
│  │                    │  │                    │                                  │
│  │ → records.create() │  │ → executeInternal()│                                  │
│  └────────────────────┘  └────────────────────┘                                  │
│                          │                                                       │
│                          ▼                                                       │
│  ┌─────────────────────────────────────────────────────────────────────────────┐│
│  │ webhookLogs                                                                 ││
│  │  { webhookId, receivedAt, payload, status, createdRecordId, ... }           ││
│  └─────────────────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────────────┘


┌─────────────────────────────────────────────────────────────────────────────────┐
│                        OUTGOING HTTP REQUESTS                                    │
│                                                                                  │
│  Action step: sendWebhook                                                        │
│           │                                                                      │
│           ▼                                                                      │
│  ┌─────────────────────────────────────────────────────────────────────────────┐│
│  │ integrations/httpActions.ts                                                 ││
│  │  ├─ Validate URL (SSRF protection)                                          ││
│  │  │   └─ Block: localhost, private IPs (10.x, 172.16.x, 192.168.x)           ││
│  │  ├─ Resolve template (if templateSlug provided)                             ││
│  │  ├─ Interpolate variables: {{record.field}}, {{previous.output}}            ││
│  │  ├─ Build auth header (bearer/basic/apiKey from env vars)                   ││
│  │  └─ ctx.scheduler.runAfter(0, sendHttpRequest)                              ││
│  └─────────────────────────────────────────────────────────────────────────────┘│
│                          │                                                       │
│                          ▼                                                       │
│  ┌─────────────────────────────────────────────────────────────────────────────┐│
│  │ httpRequestLogs                                                             ││
│  │  { templateId, method, url, statusCode, durationMs, sentAt, completedAt }   ││
│  └─────────────────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Key File Reference

| Layer | Purpose | Path |
|-------|---------|------|
| **Entry** | HTTP server | `mcp-server/src/http.ts` |
| **Entry** | MCP tool definitions | `mcp-server/src/server.ts` |
| **Auth** | OAuth strategy | `mcp-server/src/auth/strategies/oauth.ts` |
| **Auth** | Scope enforcement | `mcp-server/src/auth/scopes.ts` |
| **Schema** | Database tables | `convex/schema.ts` |
| **Records** | CRUD mutations | `convex/functions/records/mutations.ts` |
| **Actions** | Execution engine | `convex/functions/actions/mutations.ts` |
| **Triggers** | Event evaluation | `convex/lib/triggers.ts` |
| **Context** | Variable interpolation | `convex/lib/actionContext.ts` |
| **Audit** | Change logging | `convex/lib/audit.ts` |
| **Webhooks** | HTTP handlers | `convex/http.ts` |
