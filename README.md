# Agent CRM

A headless, MCP-first CRM

## Features

- **Dynamic Schema**: Define custom object types and attributes at runtime
- **Standard Objects**: People, Companies, Deals pre-configured but fully modifiable
- **Many-to-many support**: Many-to-many relationships with junction attributes
- **Full Audit Trail**: Every change logged with before/after snapshots
- **Composable Actions**: Automation via predefined step types (no code execution)
- **Multi-tenant**: Workspace isolation from day one

## Prerequisites

- [Bun](https://bun.sh) v1.0+
- [Convex](https://convex.dev) account (free tier available)

## Setup

### 1. Install Dependencies

```bash
bun install
cd mcp-server && bun install && cd ..
```

### 2. Initialize Convex

```bash
bunx convex dev
```

This will:
- Prompt you to log in (GitHub auth)
- Create a new Convex project
- Deploy the schema
- Generate TypeScript types
- Start the dev server

Keep this running in a terminal.

### 3. Configure MCP Server

Create `.env` in the `mcp-server/` directory:

```bash
CONVEX_URL=<your-convex-deployment-url>
PORT=3000  # optional, defaults to 3000
```

Find your deployment URL in the Convex dashboard or in `.env.local` after running `convex dev`.

### 4. Run MCP Server

```bash
bun run dev:mcp
```

The HTTP MCP server will start on `http://localhost:3000/mcp`.

### 5. Create a User and Workspace

The MCP server requires authentication. First, create a user via the Convex dashboard:

1. Go to **Functions** → `auth/mutations:upsertFromOAuth`
2. Run with your OAuth provider details, or for development:
   ```json
   {
     "authProvider": "dev",
     "authProviderId": "dev_user_1",
     "email": "you@example.com",
     "name": "Your Name"
   }
   ```

3. Create an API key via `auth/mutations:createApiKey` (note the user ID from step 2)

4. Use the API key to create a workspace via the MCP `workspace.create` tool

## Authentication

The MCP server supports two authentication methods:

### API Key Authentication

```bash
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "X-API-Key: crm_<prefix>_<secret>" \
  -H "X-Workspace-Id: <workspace_id>" \
  -d '{"jsonrpc": "2.0", ...}'
```

### OAuth Authentication

Configure an OAuth provider (WorkOS, PropelAuth, Auth0, or custom JWKS):

```bash
# In .env
MCP_AUTH_PROVIDER=workos
WORKOS_CLIENT_ID=client_xxx
```

Then use Bearer tokens:

```bash
curl -X POST http://localhost:3000/mcp \
  -H "Authorization: Bearer <jwt_token>" \
  -H "X-Workspace-Id: <workspace_id>" \
  -d '{"jsonrpc": "2.0", ...}'
```

## Using with MCP Clients

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
| `records.search` | Search/filter records by field values with operators (equals, contains, greaterThan, etc.) |
| `records.getRelated` | Get all related records via references and list memberships |

### Bulk Import
| Tool | Description |
|------|-------------|
| `records.bulkValidate` | Validate records before import, returns summary + session ID |
| `records.bulkCommit` | Insert validated records from a session |
| `records.bulkInspect` | Inspect specific records from a validation session |

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

### Workspace
| Tool | Description |
|------|-------------|
| `workspace.create` | Create a new workspace with seeded object types |

### Actions
| Tool | Description |
|------|-------------|
| `actions.create` | Create automation with triggers, conditions, and steps |
| `actions.list` | List available actions |
| `actions.execute` | Run an action on a record |

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

### Users & API Keys
| Tool | Description |
|------|-------------|
| `users.me` | Get current authenticated user info |
| `users.updatePreferences` | Update user preferences |
| `apiKeys.create` | Create new API key (secret shown once) |
| `apiKeys.list` | List API keys (without secrets) |
| `apiKeys.revoke` | Revoke an API key |

### Audit
| Tool | Description |
|------|-------------|
| `audit.getHistory` | Get change history for a record |

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
bun run dev:mcp
```

## Architecture

See [CLAUDE.md](./CLAUDE.md) for detailed architecture documentation.

## License

MIT
