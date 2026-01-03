import {
  prompt,
  promptRequired,
  select,
  printHeader,
  printSection,
  printSuccess,
  printError,
  printKeyValue,
  printNextSteps,
  confirm,
} from "./prompts.js";
import { writeServerEnv } from "./utils.js";

type OAuthProvider = "auth0" | "custom" | "skip";

/**
 * Run the OAuth provider setup wizard
 */
export async function runOAuthSetup(): Promise<void> {
  printHeader("OAuth Provider Setup");

  console.log("OAuth is required for:");
  console.log("  - Remote MCP access (Claude Code over HTTP)");
  console.log("  - Multi-user access with your own identity provider");
  console.log("  - Production deployments\n");

  const provider = await select<OAuthProvider>("Select OAuth provider:", [
    {
      value: "auth0",
      label: "Auth0",
      description: "Quick setup with free tier, supports OAuth proxy for MCP clients",
    },
    {
      value: "custom",
      label: "Custom OIDC provider",
      description: "Keycloak, Okta, or any OIDC-compliant IdP",
    },
    {
      value: "skip",
      label: "Skip for now",
      description: "Configure later with 'bun run setup:oauth'",
    },
  ]);

  if (provider === "skip") {
    console.log("\nSkipping OAuth setup. API key authentication will work for REST API.");
    console.log("Run 'bun run setup:oauth' when you're ready to enable remote MCP access.");
    return;
  }

  if (provider === "auth0") {
    await setupAuth0();
  } else {
    await setupCustomOidc();
  }
}

/**
 * Setup Auth0 as OAuth provider
 */
async function setupAuth0(): Promise<void> {
  printSection("Auth0 Setup Instructions");

  console.log("1. Create an Auth0 account at https://auth0.com (free tier available)\n");

  console.log("2. Create an API (Applications > APIs > Create API):");
  console.log("   - Name: Open CRM API");
  console.log("   - Identifier: https://api.open-crm.example (or your domain)");
  console.log("   - Signing Algorithm: RS256\n");

  console.log("3. Create a Regular Web Application (Applications > Applications > Create):");
  console.log("   - Type: Regular Web Applications");
  console.log("   - Add Allowed Callback URL: https://your-server.com/oauth/callback");
  console.log("   - Note the Client ID and Client Secret\n");

  console.log("4. Enable scopes in the API settings:");
  console.log("   - crm:read");
  console.log("   - crm:write");
  console.log("   - crm:admin\n");

  const ready = await prompt("Press Enter when you've completed the Auth0 setup...");

  // Collect Auth0 configuration
  printSection("Auth0 Configuration");

  const domain = await promptRequired("Auth0 domain (e.g., your-tenant.auth0.com)");
  const audience = await promptRequired("API Identifier/Audience (e.g., https://api.open-crm.example)");

  // Validate domain format
  const cleanDomain = domain.replace(/^https?:\/\//, "").replace(/\/$/, "");

  // OAuth Proxy configuration (for MCP clients)
  printSection("OAuth Proxy for MCP Clients");

  console.log("The OAuth proxy enables MCP clients (like Claude Code) to authenticate");
  console.log("by redirecting to Auth0. Without it, clients need tokens from elsewhere.\n");

  const enableProxy = await confirm("Enable OAuth proxy for MCP client authentication?", true);

  const envVars: Record<string, string> = {
    MCP_AUTH_PROVIDER: "auth0",
    AUTH0_DOMAIN: cleanDomain,
    AUTH0_AUDIENCE: audience,
  };

  if (enableProxy) {
    const webClientId = await promptRequired("Regular Web App Client ID");
    const webClientSecret = await promptRequired("Regular Web App Client Secret");
    const callbackUrl = await promptRequired("Callback URL (e.g., https://your-server.com/oauth/callback)");

    envVars.AUTH0_WEB_CLIENT_ID = webClientId;
    envVars.AUTH0_WEB_CLIENT_SECRET = webClientSecret;
    envVars.OAUTH_CALLBACK_URL = callbackUrl;
  }

  // Write to .env
  writeServerEnv(envVars);

  printSuccess("Auth0 configuration saved to server/.env");

  console.log("\nConfiguration:");
  printKeyValue("Provider", "Auth0");
  printKeyValue("Domain", cleanDomain);
  printKeyValue("Audience", audience);
  printKeyValue("OAuth Proxy", enableProxy ? "Enabled" : "Disabled");

  if (enableProxy) {
    printNextSteps([
      "Restart the server: bun run dev:server",
      "MCP clients can now connect with just the URL:",
      `  { "url": "https://your-server/mcp" }`,
      "Users will be redirected to Auth0 to authenticate",
    ]);
  } else {
    printNextSteps([
      "Restart the server: bun run dev:server",
      "Server will validate tokens from Auth0",
      `Get an M2M token: curl -X POST https://${cleanDomain}/oauth/token ...`,
      "See README.md for full M2M token request example",
    ]);
  }
}

/**
 * Setup custom OIDC provider
 */
async function setupCustomOidc(): Promise<void> {
  printSection("Custom OIDC Provider Setup");

  console.log("You'll need the following from your identity provider:\n");
  console.log("  - Issuer URL (e.g., https://your-idp.com)");
  console.log("  - JWKS URI (usually /.well-known/jwks.json)");
  console.log("  - Audience (optional, the resource identifier)\n");

  console.log("For MCP client support, ensure your provider supports:");
  console.log("  - Dynamic Client Registration (RFC 7591)");
  console.log("  - Standard OIDC discovery\n");

  // Collect OIDC configuration
  printSection("OIDC Configuration");

  const issuer = await promptRequired("Issuer URL (e.g., https://your-idp.com)");

  // Default JWKS URI based on issuer
  const defaultJwks = issuer.replace(/\/$/, "") + "/.well-known/jwks.json";
  const jwksUri = await prompt("JWKS URI", defaultJwks);

  const audience = await prompt("Audience (optional)");

  // Write to .env
  const envVars: Record<string, string> = {
    MCP_AUTH_PROVIDER: "custom",
    OAUTH_ISSUER: issuer,
    OAUTH_JWKS_URI: jwksUri || defaultJwks,
  };

  if (audience) {
    envVars.OAUTH_AUDIENCE = audience;
  }

  writeServerEnv(envVars);

  printSuccess("OIDC configuration saved to server/.env");

  console.log("\nConfiguration:");
  printKeyValue("Provider", "Custom OIDC");
  printKeyValue("Issuer", issuer);
  printKeyValue("JWKS URI", jwksUri || defaultJwks);
  if (audience) {
    printKeyValue("Audience", audience);
  }

  printNextSteps([
    "Restart the server: bun run dev:server",
    "Test OAuth: The server will validate tokens against your OIDC provider",
    "Configure your IdP to issue tokens with crm:read, crm:write, or crm:admin scopes",
  ]);
}
