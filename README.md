# Open CRM

A headless, MCP-first CRM

## Features

- **Dynamic Schema**: Define custom object types and attributes at runtime
- **Standard Objects**: People, Companies, Deals pre-configured but fully modifiable
- **Many-to-many support**: Many-to-many relationships with junction attributes
- **Full Audit Trail**: Every change logged with before/after snapshots
- **Composable Actions**: Automation via predefined step types (no code execution)
- **Multi-tenant**: Workspace isolation from day one
- **Dual API**: MCP protocol for AI agents + REST API for traditional integrations

## Prerequisites

- [Bun](https://bun.sh) v1.0+
- [Convex](https://convex.dev) account (free tier available)

## Quick Start

Get up and running in 2 minutes:

```bash
# 1. Install dependencies
bun install
cd server && bun install && cd ..

# 2. Initialize Convex (keep running in terminal)
bunx convex dev

# 3. Run setup wizard (in new terminal)
cd server && bun run setup

# 4. Start the server
bun run dev:server

# 5. Test your API key
curl -H 'X-API-Key: ocrm_live_...' http://localhost:3000/api/v1/users/me
```

The setup wizard will:
- Create your admin user and workspace
- Generate an API key for REST API access
- Configure `.mcp.json` for Claude Code (stdio transport)
- Optionally set up OAuth for remote MCP access

**That's it!** You now have:
- **REST API**: `http://localhost:3000/api/v1`
- **API Docs**: `http://localhost:3000/api/v1/docs`
- **MCP endpoint**: `http://localhost:3000/mcp`

## Setup Details

### Step 1: Install Dependencies

```bash
bun install
cd server && bun install && cd ..
```

### Step 2: Initialize Convex

```bash
bunx convex dev
```

This will prompt you to log in (GitHub auth), create a Convex project, and start the dev server.

**Keep this running in a terminal.**

### Step 3: Run Setup Wizard

```bash
cd server && bun run setup
```

The wizard guides you through:
1. Creating an admin user (email)
2. Creating a default workspace
3. Generating an API key
4. Configuring local MCP access
5. (Optional) Setting up OAuth for remote access

**Save the API key shown during setup** - it cannot be retrieved again.

### Step 4: Start the Server

```bash
bun run dev:server
```

The server starts on `http://localhost:3000` with:
- **MCP endpoint**: `http://localhost:3000/mcp`
- **REST API**: `http://localhost:3000/api/v1`
- **API Docs**: `http://localhost:3000/api/v1/docs`

### Step 5: Configure OAuth (Optional)

OAuth is required for:
- Remote MCP access (Claude Code over HTTP)
- Multi-user authentication

Run the OAuth setup:
```bash
cd server && bun run setup:oauth
```

#### Option A: Auth0 (Recommended)

1. Create a tenant at [auth0.com](https://auth0.com)
2. Create an **API** (Applications → APIs):
   - Identifier: `https://api.open-crm.example`
3. Create an **Application** (Machine to Machine for agents, or SPA/Web App for users)
4. **Enable Dynamic Client Registration** (required for MCP clients like Claude Code):
   - Go to Settings → Advanced → enable "OIDC Conformant" and DCR
5. Enter your Auth0 domain and audience when prompted

#### Option B: Custom OIDC Provider

Any OIDC-compliant provider that supports Dynamic Client Registration (RFC 7591).

> **Note**: MCP clients like Claude Code require DCR support for automatic OAuth registration. Without DCR, use API keys for the REST API or stdio transport for local MCP.

### First Login (OAuth users)

When you authenticate for the first time:
- A **user record** is automatically created from your OAuth token
- A **default workspace** is automatically created with People, Companies, and Deals object types
- You become the workspace **owner**

No manual user or workspace creation required!

## Authentication

The server supports two authentication methods:

### Option 1: OAuth 2.1 (for interactive users)

```bash
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <jwt_token>" \
  -d '{"jsonrpc": "2.0", ...}'
```

### Option 2: API Keys (for agents and integrations)

API keys provide simpler auth for server-to-server integrations, CI/CD, and AI agents.

1. Create a key via MCP or REST (requires OAuth auth initially):
   ```bash
   curl -X POST http://localhost:3000/api/v1/api-keys \
     -H "Authorization: Bearer <oauth_token>" \
     -H "Content-Type: application/json" \
     -d '{"name": "Agent Key", "scopes": ["crm:write"]}'
   ```

2. Use the key in subsequent requests:
   ```bash
   curl http://localhost:3000/api/v1/users/me \
     -H "X-API-Key: ocrm_live_..."
   ```

**Key format:** `ocrm_live_<32 alphanumeric chars>`

**Notes:**
- Keys are workspace-scoped and inherit specified permissions
- Raw key shown only once at creation - store it securely
- Keys can have optional expiration dates
- Revoke keys immediately via `apiKeys.revoke`

See [CLAUDE.md](./CLAUDE.md) for detailed authentication setup instructions.

## Using with Claude Code

### Option 1: Remote MCP (HTTP with OAuth) - Recommended

Connect Claude Code to your deployed MCP server via HTTP. Authentication is handled automatically via OAuth - just authenticate when prompted and your workspace will be created automatically on first login.

### Option 2: Local Development (stdio)

For local development, Claude Code can spawn the server as a subprocess. This requires manual user/workspace setup:

1. Create a dev user via Convex dashboard (**Functions** → `auth/mutations:upsertFromOAuth`):
   ```json
   {
     "authProvider": "dev",
     "authProviderId": "dev_user_1",
     "email": "you@example.com",
     "name": "Your Name"
   }
   ```

2. Create a workspace via **Functions** → `workspaces/mutations:create`:
   ```json
   {
     "name": "Dev Workspace",
     "slug": "dev-workspace",
     "userId": "<USER_ID_FROM_STEP_1>"
   }
   ```

3. Create `.mcp.json` in the project root:
   ```json
   {
     "mcpServers": {
       "open-crm": {
         "type": "stdio",
         "command": "bun",
         "args": ["run", "server/src/stdio.ts"],
         "env": {
           "CONVEX_URL": "https://your-deployment.convex.cloud",
           "DEV_USER_EMAIL": "you@example.com",
           "DEV_WORKSPACE_ID": "YOUR_WORKSPACE_ID"
         }
       }
     }
   }
   ```

4. Restart Claude Code or run `/mcp` to verify the connection.

Note: Stdio transport is recommended for local development. For production integrations, use the HTTP transport with OAuth 2.1.

## Using with Other MCP Clients

The server exposes a standard MCP HTTP endpoint at `/mcp`. Connect using any MCP client that supports HTTP transport with authentication headers.

## MCP Tools

### Records
| Tool | Description |
|------|-------------|
| `records.create` | Create a record of any object type |
| `records.get` | Get a single record by ID |
| `records.list` | List records of an object type |
| `records.update` | Update record fields |
| `records.delete` | Delete a record |
| `records.archive` | Archive a record (soft delete) |
| `records.restore` | Restore an archived record |
| `records.search` | Search/filter records by field values |
| `records.getRelated` | Get related records via references and list memberships |
| `records.bulkValidate` | Validate records before import |
| `records.bulkCommit` | Insert validated records from a session |
| `records.bulkInspect` | Inspect specific records from a validation session |
| `records.bulkUpdate` | Update multiple records with the same values |
| `records.merge` | Merge source records into a target record |

### Schema
| Tool | Description |
|------|-------------|
| `schema.objectTypes.list` | List all object types |
| `schema.objectTypes.get` | Get object type with attributes |
| `schema.objectTypes.create` | Create custom object type |
| `schema.attributes.create` | Add attribute to object type |

### Lists
| Tool | Description |
|------|-------------|
| `lists.create` | Create a custom list (many-to-many relationship) with attributes |
| `lists.getEntries` | Get list entries (optionally by parent) |
| `lists.addEntry` | Add record to a list |
| `lists.removeEntry` | Remove record from a list |
| `lists.bulkAddEntry` | Add multiple records to a list |
| `lists.bulkRemoveEntry` | Remove multiple records from a list |

### Workspace
| Tool | Description |
|------|-------------|
| `workspace.create` | Create a new workspace with seeded object types |
| `workspace.updateMember` | Update a workspace member's role |
| `workspace.removeMember` | Remove a member from the workspace |

### Actions
| Tool | Description |
|------|-------------|
| `actions.create` | Create automation with triggers, conditions, and 15 step types |
| `actions.list` | List available actions |
| `actions.execute` | Run an action on a record |
| `actions.delete` | Delete an action |

### Integrations
| Tool | Description |
|------|-------------|
| `integrations.createWebhookEndpoint` | Create incoming webhook endpoint |
| `integrations.listWebhookEndpoints` | List webhook endpoints |
| `integrations.getWebhookLogs` | Get webhook request logs |
| `integrations.createTemplate` | Create reusable HTTP request template |
| `integrations.listTemplates` | List HTTP templates |
| `integrations.sendRequest` | Send HTTP request |
| `integrations.getRequestLogs` | Get outgoing request logs |

### Users
| Tool | Description |
|------|-------------|
| `users.me` | Get current authenticated user info |
| `users.updatePreferences` | Update user preferences |

### Audit
| Tool | Description |
|------|-------------|
| `audit.getHistory` | Get change history for a record |

### API Keys
| Tool | Description |
|------|-------------|
| `apiKeys.create` | Create a new API key (returns raw key once) |
| `apiKeys.list` | List API keys for current workspace |
| `apiKeys.revoke` | Revoke an API key |

## REST API

A RESTful HTTP API runs at `/api/v1` with full parity to the MCP tools. Use this for traditional integrations, webhooks, or any HTTP client.

**Documentation**: Visit `/api/v1/docs` for interactive Swagger UI, or `/api/v1/openapi.json` for the OpenAPI spec.

**Authentication**: OAuth 2.1 or API Key:
- OAuth: `Authorization: Bearer <token>`
- API Key: `X-API-Key: ocrm_live_...`

**Example**:
```bash
# Create a record
curl -X POST http://localhost:3000/api/v1/records \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"objectType": "people", "data": {"name": "Jane Doe", "email": "jane@example.com"}}'

# Search records
curl -X POST http://localhost:3000/api/v1/records/search \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"objectType": "deals", "filters": [{"field": "stage", "operator": "equals", "value": "won"}]}'
```

See [CLAUDE.md](./CLAUDE.md) for full endpoint reference.

## Example Usage

Once connected via MCP:

```
Create a new person named "Jane Doe" with email jane@example.com
```

```
List all companies in the workspace
```

```
Find all deals worth over $10,000 in the negotiation stage
```

```
Show me all contacts at Acme Corp
```

```
Create a custom object type called "Projects" with name, status, and due_date attributes
```

```
Create a "Team Members" list that links people to companies with a role attribute
```

```
Import these 50 contacts from my CSV and show me which ones have validation errors
```

```
Show me the audit history for the last deal I created
```

```
Create an action that when a deal stage changes to "won", creates a project and sends a webhook to Slack
```

## Development

```bash
# Terminal 1: Convex dev server
bun run dev

# Terminal 2: MCP server (after Convex is running)
bun run dev:server
```

## Architecture

See [CLAUDE.md](./CLAUDE.md) for detailed architecture documentation including:

- Directory structure and core concepts
- MCP tools reference (44 tools)
- REST API reference (44 endpoints)
- Authentication flow (OAuth 2.1 + API Keys)
- Multi-tenancy structure
- Environment variables

## License

MIT
