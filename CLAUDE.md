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
│   ├── lib/                    # Shared utilities
│   │   ├── audit.ts            # Audit log helper
│   │   └── auth.ts             # Authorization helper
│   └── functions/              # Convex functions
│       ├── workspaces/         # Workspace management + seeding
│       ├── objectTypes/        # Dynamic object type definitions
│       ├── attributes/         # Dynamic attribute definitions
│       ├── records/            # Record CRUD
│       ├── lists/              # Many-to-many lists
│       ├── actions/            # Composable automation actions
│       ├── auth/               # Auth queries and mutations
│       └── audit/              # Audit log queries
│
├── mcp-server/                 # HTTP MCP server (Bun)
│   └── src/
│       ├── index.ts            # Entry point (starts HTTP server)
│       ├── http.ts             # HTTP server with auth middleware
│       ├── server.ts           # MCP server with all tools
│       ├── convex/client.ts    # Convex HTTP client
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

Step types:
- **Field ops**: `updateField`, `clearField`, `copyField`, `transformField`
- **Record ops**: `createRecord`, `deleteRecord`, `archiveRecord`
- **List ops**: `addToList`, `removeFromList`, `updateListEntry`
- **Control flow**: `condition` (if/else branches), `loop` (iterate over records/arrays)
- **External**: `sendWebhook`, `callMcpTool`

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
- `actions.create` - Create automations with triggers, conditions, and 14 step types
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

OAuth provider configuration (choose one):
```bash
# PropelAuth (recommended)
MCP_AUTH_PROVIDER=propelauth
PROPELAUTH_AUTH_URL=https://xxx.propelauthtest.com

# WorkOS
MCP_AUTH_PROVIDER=workos
WORKOS_CLIENT_ID=client_xxx

# Auth0
MCP_AUTH_PROVIDER=auth0
AUTH0_DOMAIN=your-tenant.auth0.com
AUTH0_AUDIENCE=https://api.agent-crm.example

# Custom JWKS
MCP_AUTH_PROVIDER=custom
OAUTH_ISSUER=https://your-idp.com
OAUTH_JWKS_URI=https://your-idp.com/.well-known/jwks.json
OAUTH_AUDIENCE=https://api.agent-crm.example
```

Optional:
```bash
MCP_RESOURCE_URI=https://api.agent-crm.example/mcp  # For OAuth protected resource metadata
PORT=3000                                           # HTTP server port
HOSTNAME=0.0.0.0                                    # HTTP server hostname
CORS_ALLOWED_ORIGINS=https://app.example.com        # Comma-separated allowed origins
```

## Authentication (OAuth 2.1)

The MCP server implements OAuth 2.1 as a Resource Server (RFC 9728 compliant). It validates JWT tokens but does not issue them - users authenticate with an external OAuth provider.

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
