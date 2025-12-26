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
bun run dev:mcp          # Runs MCP server (in mcp-server/)

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
│       └── audit/              # Audit log queries
│
├── mcp-server/                 # MCP server (Bun)
│   └── src/
│       ├── index.ts            # Entry point
│       ├── server.ts           # MCP server with all tools
│       └── convex/client.ts    # Convex HTTP client
```

### Core Concepts

**Dynamic Schema**: Object types and attributes are defined at runtime in `objectTypes` and `attributes` tables. Standard objects (People, Companies, Deals) are seeded on workspace creation but fully modifiable.

**Records**: All data stored in single `records` table with `objectTypeId` discriminator. Attribute values in `data` field keyed by slug.

**Lists**: Attio-style many-to-many relationships with junction attributes. `lists` defines the relationship, `listEntries` holds the connections with their own `data`.

**Audit Trail**: Every mutation logs to `auditLogs` with before/after snapshots, actor, and timestamp.

**Actions**: Composable automations using predefined step types (updateField, sendWebhook, condition, etc.). No user code execution.

### MCP Tools

Record operations:
- `records.create`, `records.get`, `records.list`, `records.update`, `records.delete`

Schema management:
- `schema.objectTypes.list`, `schema.objectTypes.get`, `schema.objectTypes.create`
- `schema.attributes.create`

List operations:
- `lists.getEntries`, `lists.addEntry`, `lists.removeEntry`

Actions:
- `actions.list`, `actions.execute`

Audit:
- `audit.getHistory`

## Environment Variables

Required in `.env`:
```
CONVEX_URL=https://your-deployment.convex.cloud
```

## Multi-Tenancy

All data is scoped by `workspaceId`. Every table has workspace indexes. Create a workspace first via `workspaces.mutations.create` which seeds system object types.
