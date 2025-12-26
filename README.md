# Massive CRM

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

### 3. Create a Workspace

Once Convex is running, create your first workspace. In the Convex dashboard, go to **Functions** and run:

```
workspaces/mutations:create
```

With arguments:
```json
{
  "name": "My Workspace",
  "slug": "my-workspace",
  "ownerUserId": "user_123",
  "ownerEmail": "you@example.com"
}
```

This seeds People, Companies, Deals object types with default attributes, plus Contacts and Deal Contacts lists.

### 4. Configure MCP Server

Create `.env` in the project root (or update existing):

```bash
CONVEX_URL=<your-convex-deployment-url>
```

Find your deployment URL in the Convex dashboard or in `.env.local` after running `convex dev`.

### 5. Run MCP Server

```bash
bun run dev:mcp
```

## Using with Claude Desktop

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "massive-crm": {
      "command": "bun",
      "args": ["run", "/path/to/massive-crm/mcp-server/src/index.ts"],
      "env": {
        "CONVEX_URL": "https://your-deployment.convex.cloud"
      }
    }
  }
}
```

## MCP Tools

### Records
| Tool | Description |
|------|-------------|
| `records.create` | Create a record of any object type |
| `records.get` | Get a single record by ID |
| `records.list` | List records of an object type |
| `records.update` | Update record fields |
| `records.delete` | Delete a record |

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
| `lists.getEntries` | Get list entries (optionally by parent) |
| `lists.addEntry` | Add record to a list |
| `lists.removeEntry` | Remove record from a list |

### Actions
| Tool | Description |
|------|-------------|
| `actions.list` | List available actions |
| `actions.execute` | Run an action on a record |

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
Create a custom object type called "Projects" with name, status, and due_date attributes
```

```
Show me the audit history for the last deal I created
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
