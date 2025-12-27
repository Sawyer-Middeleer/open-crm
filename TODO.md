# to-do list

## Done
- configure convex
- basic MCP tools (records CRUD, schema management, lists, audit)
- `records.search` - filter/search by field values
- `records.getRelated` - traverse relationships (contacts at company, deals for person)
- `workspace.create` tool - self-service setup via MCP
- `records.bulkValidate/bulkCommit/bulkInspect` - bulk import with validation
- `lists.create` tool - create custom list definitions via MCP
- `actions.create` tool - define automations via MCP
- action system execution (14 step types: field ops, record ops, list ops, webhooks, conditions, loops, MCP tool calls)
- integrations system (incoming webhooks, outgoing HTTP, templates)
  - incoming webhooks: POST to `/webhooks/{workspaceId}/{slug}` with HMAC-SHA256 signature verification
  - outgoing HTTP: `sendWebhook` step now executes via scheduled action
  - HTTP templates: reusable request configs with {{variable}} interpolation
  - auth via environment variables (bearer, basic, API key)
  - MCP tools: createWebhookEndpoint, listWebhookEndpoints, getWebhookLogs, createTemplate, listTemplates, sendRequest, getRequestLogs
- remote HTTP MCP with StreamableHTTP transport
- user management and authentication system
  - users table decoupled from workspaces
  - API key auth (`X-API-Key` header)
  - OAuth 2.1 with pluggable providers (WorkOS, PropelAuth, Auth0, custom JWKS)
  - workspace selection via `X-Workspace-Id` header
  - MCP tools: users.me, users.updatePreferences, apiKeys.create, apiKeys.list, apiKeys.revoke

## High Priority

## Medium Priority

## Future
- `records.merge` - deduplicate contacts/companies
- `schema.objectTypes.delete` - clean up custom types
- self hostable (Convex self-host)
- write tests
- create simple pre-bundled ui
- landing page
