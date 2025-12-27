# Manual Curl Tests

Start the server first:
```bash
bun run dev
```

## Health Check

```bash
# Should return 200 with status: "ok"
curl http://localhost:3000/health
```

Expected:
```json
{"status":"ok","timestamp":"2024-..."}
```

## OAuth Discovery

```bash
# Should return OAuth protected resource metadata
curl http://localhost:3000/.well-known/oauth-protected-resource
```

Expected:
```json
{
  "resource": "https://api.agent-crm.example/mcp",
  "bearer_methods_supported": ["header"],
  "resource_signing_alg_values_supported": ["RS256", "ES256"]
}
```

## CORS Preflight

```bash
# With allowed origin (set CORS_ALLOWED_ORIGINS=https://app.example.com)
curl -X OPTIONS http://localhost:3000/mcp \
  -H "Origin: https://app.example.com" \
  -v 2>&1 | grep -i "access-control"

# Should see:
# access-control-allow-origin: https://app.example.com
# access-control-allow-credentials: true
```

```bash
# With disallowed origin (should NOT have allow-origin header)
curl -X OPTIONS http://localhost:3000/mcp \
  -H "Origin: https://evil.com" \
  -v 2>&1 | grep -i "access-control"

# Should NOT see access-control-allow-origin
```

## Authentication Tests

### No Credentials (401)

```bash
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json"
```

Expected: 401 Unauthorized

### Invalid API Key (401)

```bash
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "X-API-Key: crm_invalid_key"
```

Expected: 401 with "Invalid API key" message

### Malformed API Key (401)

```bash
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "X-API-Key: not_a_valid_format"
```

Expected: 401 with "Invalid API key format" message

### Valid API Key (needs real key from database)

```bash
# Create an API key first using Convex dashboard or MCP tool
# Then test with:
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "X-API-Key: crm_yourprefix_yoursecret" \
  -H "X-Workspace-Id: your_workspace_id" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
```

## 404 Test

```bash
curl http://localhost:3000/unknown/path
```

Expected:
```json
{"error":"Not found","path":"/unknown/path"}
```

## SSRF Protection Tests

These require a valid API key. The server should block:

```bash
# Localhost (blocked)
# Use integrations.sendRequest tool with url: "http://localhost:8080"

# Private IP (blocked)
# Use integrations.sendRequest tool with url: "http://10.0.0.1/api"

# AWS Metadata (blocked)
# Use integrations.sendRequest tool with url: "http://169.254.169.254/latest/meta-data/"
```

## Session Expiration

Sessions expire after 30 minutes of inactivity. To test:

1. Make a request to get a session ID
2. Wait 30+ minutes
3. Make another request with the same session ID
4. Should get a new session (old one expired)

Note: For faster testing, you can temporarily reduce `SESSION_TTL_MS` in http.ts.
