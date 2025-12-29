#!/usr/bin/env node
/**
 * Stdio transport entry point for local development with Claude Code
 *
 * Usage:
 *   CONVEX_URL=... DEV_USER_EMAIL=... DEV_WORKSPACE_ID=... bun run src/stdio.ts
 *
 * Claude Code will spawn this as a subprocess and communicate via stdin/stdout.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer, setStaticAuthContext } from "./server.js";
import { getConvexClient } from "./convex/client.js";
import { api } from "../../convex/_generated/api.js";
import type { Id } from "../../convex/_generated/dataModel.js";

async function main() {
  // Validate required environment variables
  const convexUrl = process.env.CONVEX_URL;
  if (!convexUrl) {
    console.error("Error: CONVEX_URL environment variable is required");
    process.exit(1);
  }

  const devEmail = process.env.DEV_USER_EMAIL;
  const devWorkspaceId = process.env.DEV_WORKSPACE_ID;

  if (!devEmail || !devWorkspaceId) {
    console.error(
      "Error: DEV_USER_EMAIL and DEV_WORKSPACE_ID environment variables are required"
    );
    process.exit(1);
  }

  // Look up user and workspace membership
  const client = getConvexClient();

  const user = await client.query(api.functions.auth.queries.getUserByEmail, {
    email: devEmail,
  });

  if (!user) {
    console.error(`Error: User not found with email '${devEmail}'`);
    process.exit(1);
  }

  const member = await client.query(
    api.functions.auth.queries.getMemberByUserAndWorkspace,
    {
      userId: user._id,
      workspaceId: devWorkspaceId as Id<"workspaces">,
    }
  );

  if (!member) {
    console.error(
      `Error: User '${devEmail}' is not a member of workspace '${devWorkspaceId}'`
    );
    process.exit(1);
  }

  console.error(
    `[MCP Stdio] Authenticated: ${devEmail} -> workspace ${devWorkspaceId} (${member.role})`
  );

  // Set static auth context for all tool calls (stdio doesn't have per-request auth)
  setStaticAuthContext({
    userId: user._id,
    email: user.email,
    workspaceId: member.workspaceId,
    workspaceMemberId: member._id,
    role: member.role,
    authMethod: "oauth",
    provider: "dev-stdio",
    scopes: ["crm:admin"], // Full access for dev
  });

  // Create the MCP server
  const mcpServer = createServer();

  // Create stdio transport and connect
  const transport = new StdioServerTransport();
  await mcpServer.server.connect(transport);

  console.error("[MCP Stdio] Server running on stdio transport");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
