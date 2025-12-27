# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Massive CRM is a headless, MCP-first CRM built with Convex and Bun. It has no UI - all interactions happen via the Model Context Protocol (MCP).

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
├── convex/                      # Convex backend
│   ├── schema.ts               # Database schema (all tables)
│   ├── lib/                    # Shared utilities
│   │   └── audit.ts            # Audit log helper
│   └── functions/              # Convex functions
│       ├── workspaces/         # Workspace management + seeding
│       ├── objectTypes/        # Dynamic object type definitions
│       ├── attributes/         # Dynamic attribute definitions
│       ├── records/            # Record CRUD
│       ├── lists/              # Attio-style many-to-many lists
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
│       └── auth/               # Authentication system
│           ├── types.ts        # AuthContext, AuthProvider interfaces
│           ├── manager.ts      # AuthManager orchestration
│           ├── config.ts       # Environment-based configuration
│           ├── strategies/     # Auth strategies
│           │   ├── api-key.ts  # X-API-Key header auth
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

**Lists**: Attio-style many-to-many relationships with junction attributes. `lists` defines the relationship, `listEntries` holds the connections with their own `data`.

**Audit Trail**: Every mutation logs to `auditLogs` with before/after snapshots, actor, and timestamp.

**Actions**: Composable automations using predefined step types. No user code execution.

Step types:
- **Field ops**: `updateField`, `clearField`, `copyField`, `transformField`
- **Record ops**: `createRecord`, `deleteRecord`, `archiveRecord`
- **List ops**: `addToList`, `removeFromList`, `updateListEntry`
- **Control flow**: `condition` (if/else branches), `loop` (iterate over records/arrays)
- **External**: `sendWebhook`, `callMcpTool`

Variable interpolation: `{{record.field}}`, `{{previous.output}}`, `{{loopItem}}`, `{{loopIndex}}`

### MCP Tools (35 total)

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
- `workspace.create` - Self-service workspace creation via MCP

Actions:
- `actions.create` - Create automations with triggers, conditions, and 14 step types
- `actions.list`, `actions.execute`

Integrations:
- `integrations.createWebhookEndpoint`, `integrations.listWebhookEndpoints`, `integrations.getWebhookLogs`
- `integrations.createTemplate`, `integrations.listTemplates`, `integrations.sendRequest`, `integrations.getRequestLogs`

Users & API Keys:
- `users.me` - Get current authenticated user and their workspaces
- `users.updatePreferences` - Update user preferences (timezone, default workspace)
- `apiKeys.create` - Create API key (secret shown only once)
- `apiKeys.list` - List keys for workspace (without secrets)
- `apiKeys.revoke` - Revoke an API key

Audit:
- `audit.getHistory`

## Environment Variables

Required in `.env`:
```
CONVEX_URL=https://your-deployment.convex.cloud
```

Optional auth provider configuration (choose one):
```bash
# WorkOS
MCP_AUTH_PROVIDER=workos
WORKOS_CLIENT_ID=client_xxx

# PropelAuth
MCP_AUTH_PROVIDER=propelauth
PROPELAUTH_AUTH_URL=https://xxx.propelauthtest.com

# Auth0
MCP_AUTH_PROVIDER=auth0
AUTH0_DOMAIN=your-tenant.auth0.com
AUTH0_AUDIENCE=https://api.massive-crm.example

# Custom JWKS
MCP_AUTH_PROVIDER=custom
OAUTH_ISSUER=https://your-idp.com
OAUTH_JWKS_URI=https://your-idp.com/.well-known/jwks.json
```

## Authentication

The MCP server uses HTTP transport with pluggable authentication:

**API Key auth**: `X-API-Key: mcrm_<prefix>_<secret>` + `X-Workspace-Id` header

**OAuth auth**: `Authorization: Bearer <jwt>` + `X-Workspace-Id` header

All tools automatically use auth context - no explicit `workspaceId` or `actorId` parameters needed.

## Multi-Tenancy

All data is scoped by `workspaceId`. Every table has workspace indexes. Users can belong to multiple workspaces with different roles (owner, admin, member, viewer).
