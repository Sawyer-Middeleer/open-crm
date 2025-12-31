import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../convex/_generated/api.js";
import { generateApiKey } from "../auth/strategies/apikey.js";
import {
  prompt,
  promptRequired,
  confirm,
  printHeader,
  printWarning,
  printSuccess,
  printError,
  printKeyValue,
  printNextSteps,
} from "./prompts.js";
import {
  getConvexUrl,
  writeServerEnvLocal,
  writeMcpConfig,
  isValidEmail,
} from "./utils.js";
import { runOAuthSetup } from "./oauth-setup.js";

/**
 * Run the first-time setup wizard
 */
export async function runSetupWizard(): Promise<void> {
  printHeader("Open CRM Setup Wizard");

  // Step 1: Check CONVEX_URL
  const convexUrl = getConvexUrl();
  if (!convexUrl) {
    printError("CONVEX_URL not found!");
    console.log("Please run 'bunx convex dev' first to set up your Convex deployment.");
    console.log("This will create a .env.local file with your CONVEX_URL.");
    console.log("\nThen run this setup again.");
    process.exit(1);
  }

  console.log(`Convex deployment: ${convexUrl}\n`);

  // Initialize Convex client
  const convex = new ConvexHttpClient(convexUrl);

  // Step 2: Get admin email
  let email = "";
  while (!email) {
    email = await promptRequired("Admin email");
    if (!isValidEmail(email)) {
      printError("Invalid email format. Please enter a valid email.");
      email = "";
    }
  }

  // Step 3: Check if user already exists
  try {
    const status = await convex.query(api.functions.setup.bootstrap.getSetupStatus, { email });

    if (status.exists) {
      console.log(`\nUser '${email}' already exists.`);

      if (status.workspaces && status.workspaces.length > 0) {
        console.log("\nExisting workspaces:");
        for (const ws of status.workspaces) {
          console.log(`  - ${ws.name} (${ws.slug}) - ${ws.role}`);
        }
      }

      const createNew = await confirm("\nCreate a new workspace for this user?", false);
      if (createNew) {
        await createAdditionalWorkspace(convex, email);
        return;
      }

      console.log("\nSetup cancelled. Use your existing workspace.");
      process.exit(0);
    }
  } catch (err: any) {
    // Query might fail if types aren't generated yet - continue with setup
    if (!err.message?.includes("Could not find")) {
      throw err;
    }
  }

  // Step 4: Get optional name
  const name = await prompt("Your name (optional)");

  // Step 5: Get optional workspace name
  const workspaceName = await prompt("Workspace name (optional)", name ? `${name}'s Workspace` : undefined);

  // Step 6: Generate API key
  console.log("\nGenerating API key...");
  const { rawKey, keyHash, keyPrefix } = generateApiKey("live");

  // Step 7: Create everything via bootstrap mutation
  console.log("Creating workspace and admin user...\n");

  try {
    const result = await convex.mutation(api.functions.setup.bootstrap.bootstrap, {
      email,
      name: name || undefined,
      workspaceName: workspaceName || undefined,
      keyHash,
      keyPrefix,
    });

    // Display the API key with big warning
    printWarning("Save this API key now! It will NOT be shown again.");
    console.log(`  API Key: ${rawKey}\n`);
    console.log("=".repeat(60) + "\n");

    // Show what was created
    console.log("Created:");
    printKeyValue("User", email);
    printKeyValue("Workspace", result.workspaceSlug);
    printKeyValue("Workspace ID", result.workspaceId);

    // Write .env.local for stdio transport
    writeServerEnvLocal({
      DEV_USER_EMAIL: email,
      DEV_WORKSPACE_ID: result.workspaceId,
    });
    console.log("\nWrote DEV_USER_EMAIL and DEV_WORKSPACE_ID to server/.env.local");

    // Write .mcp.json for Claude Code
    writeMcpConfig(convexUrl, email, result.workspaceId);
    console.log("Wrote .mcp.json for Claude Code (stdio transport)");

    // Ask about OAuth setup
    const setupOAuth = await confirm("\nSet up OAuth for remote MCP access?", false);

    if (setupOAuth) {
      await runOAuthSetup();
    } else {
      console.log("\nOAuth not configured. You can run 'bun run setup:oauth' later.");
      console.log("Note: OAuth is required for MCP over HTTP (remote access).");
    }

    // Final summary
    printSuccess("Setup complete!");

    printNextSteps([
      "Start the server: bun run dev:server",
      `Test with API key: curl -H 'X-API-Key: ${rawKey}' http://localhost:3000/api/v1/users/me`,
      "For local MCP (stdio), restart Claude Code and run /mcp to verify",
      "For remote MCP, configure OAuth with 'bun run setup:oauth'",
    ]);

  } catch (err: any) {
    printError(err.message || "Failed to complete setup");
    process.exit(1);
  }
}

/**
 * Create an additional workspace for an existing user
 */
async function createAdditionalWorkspace(convex: ConvexHttpClient, email: string): Promise<void> {
  const workspaceName = await prompt("New workspace name");

  console.log("\nGenerating API key for new workspace...");
  const { rawKey, keyHash, keyPrefix } = generateApiKey("live");

  console.log("Creating workspace...\n");

  try {
    const result = await convex.mutation(
      api.functions.setup.bootstrap.createWorkspaceForUser,
      {
        email,
        workspaceName: workspaceName || undefined,
        keyHash,
        keyPrefix,
      }
    );

    printWarning("Save this API key now! It will NOT be shown again.");
    console.log(`  API Key: ${rawKey}\n`);
    console.log("=".repeat(60) + "\n");

    console.log("Created:");
    printKeyValue("Workspace", result.workspaceSlug);
    printKeyValue("Workspace ID", result.workspaceId);

    // Update .env.local to use new workspace
    const updateEnv = await confirm("\nUpdate .env.local to use this workspace?", true);
    if (updateEnv) {
      const convexUrl = getConvexUrl()!;
      writeServerEnvLocal({
        DEV_USER_EMAIL: email,
        DEV_WORKSPACE_ID: result.workspaceId,
      });
      writeMcpConfig(convexUrl, email, result.workspaceId);
      console.log("Updated server/.env.local and .mcp.json");
    }

    printSuccess("Workspace created!");

  } catch (err: any) {
    printError(err.message || "Failed to create workspace");
    process.exit(1);
  }
}
