import * as fs from "fs";
import * as path from "path";

/**
 * Get the server directory path
 */
export function getServerDir(): string {
  return path.resolve(__dirname, "../..");
}

/**
 * Get the project root directory path
 */
export function getProjectRoot(): string {
  return path.resolve(getServerDir(), "..");
}

/**
 * Read an env file and parse it into a Record
 */
export function readEnvFile(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  const content = fs.readFileSync(filePath, "utf-8");
  const vars: Record<string, string> = {};

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const eqIndex = trimmed.indexOf("=");
    if (eqIndex > 0) {
      const key = trimmed.slice(0, eqIndex).trim();
      let value = trimmed.slice(eqIndex + 1).trim();

      // Remove quotes if present
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      vars[key] = value;
    }
  }

  return vars;
}

/**
 * Write variables to an env file
 * Creates the file if it doesn't exist, merges with existing if it does
 */
export function writeEnvFile(
  filePath: string,
  vars: Record<string, string>,
  options: { merge?: boolean; comment?: string } = {}
): void {
  const { merge = true, comment } = options;

  let existing: Record<string, string> = {};
  if (merge && fs.existsSync(filePath)) {
    existing = readEnvFile(filePath);
  }

  const merged = { ...existing, ...vars };

  const lines: string[] = [];

  // Add comment header if provided
  if (comment && !fs.existsSync(filePath)) {
    lines.push(`# ${comment}`);
    lines.push("");
  }

  // Write all variables
  for (const [key, value] of Object.entries(merged)) {
    // Quote values that contain spaces or special characters
    const needsQuotes = /[\s#$]/.test(value);
    const formattedValue = needsQuotes ? `"${value}"` : value;
    lines.push(`${key}=${formattedValue}`);
  }

  // Ensure trailing newline
  lines.push("");

  fs.writeFileSync(filePath, lines.join("\n"), "utf-8");
}

/**
 * Get the CONVEX_URL from environment or .env.local
 */
export function getConvexUrl(): string | null {
  // First check environment variable
  if (process.env.CONVEX_URL) {
    return process.env.CONVEX_URL;
  }

  // Check server/.env
  const serverEnvPath = path.join(getServerDir(), ".env");
  if (fs.existsSync(serverEnvPath)) {
    const vars = readEnvFile(serverEnvPath);
    if (vars.CONVEX_URL) {
      return vars.CONVEX_URL;
    }
  }

  // Check project root .env.local (created by convex dev)
  const rootEnvLocalPath = path.join(getProjectRoot(), ".env.local");
  if (fs.existsSync(rootEnvLocalPath)) {
    const vars = readEnvFile(rootEnvLocalPath);
    if (vars.CONVEX_URL) {
      return vars.CONVEX_URL;
    }
  }

  // Check project root .env
  const rootEnvPath = path.join(getProjectRoot(), ".env");
  if (fs.existsSync(rootEnvPath)) {
    const vars = readEnvFile(rootEnvPath);
    if (vars.CONVEX_URL) {
      return vars.CONVEX_URL;
    }
  }

  return null;
}

/**
 * Write to server/.env
 */
export function writeServerEnv(vars: Record<string, string>): void {
  const envPath = path.join(getServerDir(), ".env");
  writeEnvFile(envPath, vars, {
    merge: true,
    comment: "Open CRM Server Configuration",
  });
}

/**
 * Write to server/.env.local (for dev user config)
 */
export function writeServerEnvLocal(vars: Record<string, string>): void {
  const envLocalPath = path.join(getServerDir(), ".env.local");
  writeEnvFile(envLocalPath, vars, {
    merge: true,
    comment: "Local development configuration (do not commit)",
  });
}

/**
 * Check if a file exists
 */
export function fileExists(filePath: string): boolean {
  return fs.existsSync(filePath);
}

/**
 * Validate email format
 */
export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Format a workspace ID for display
 */
export function formatWorkspaceId(id: string): string {
  // Convex IDs are long, just show first 12 chars for display
  if (id.length > 16) {
    return `${id.slice(0, 12)}...`;
  }
  return id;
}

/**
 * Create the .mcp.json config for Claude Code
 */
export function writeMcpConfig(
  convexUrl: string,
  devUserEmail: string,
  workspaceId: string
): void {
  const projectRoot = getProjectRoot();
  const mcpConfigPath = path.join(projectRoot, ".mcp.json");

  const config = {
    mcpServers: {
      "open-crm": {
        type: "stdio",
        command: "bun",
        args: ["run", "server/src/stdio.ts"],
        env: {
          CONVEX_URL: convexUrl,
          DEV_USER_EMAIL: devUserEmail,
          DEV_WORKSPACE_ID: workspaceId,
        },
      },
    },
  };

  fs.writeFileSync(mcpConfigPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
}
