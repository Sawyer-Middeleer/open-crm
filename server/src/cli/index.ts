#!/usr/bin/env bun

import { runSetupWizard } from "./setup.js";
import { runOAuthSetup } from "./oauth-setup.js";

const command = process.argv[2];

async function main() {
  switch (command) {
    case "setup":
      await runSetupWizard();
      break;

    case "setup:oauth":
    case "oauth":
      await runOAuthSetup();
      break;

    case "help":
    case "--help":
    case "-h":
      printHelp();
      break;

    default:
      if (command) {
        console.error(`Unknown command: ${command}\n`);
      }
      printHelp();
      process.exit(command ? 1 : 0);
  }
}

function printHelp() {
  console.log(`
Open CRM CLI

Usage:
  bun run cli <command>

Commands:
  setup        Run first-time setup wizard (creates admin user, workspace, and API key)
  setup:oauth  Configure OAuth provider (for remote MCP access)
  help         Show this help message

Examples:
  bun run cli setup       # First-time setup
  bun run cli setup:oauth # Add/update OAuth configuration

For more information, see README.md
`);
}

// Handle graceful shutdown
process.on("SIGINT", () => {
  console.log("\n\nSetup cancelled.");
  process.exit(0);
});

// Run main
main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
