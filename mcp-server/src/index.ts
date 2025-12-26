#!/usr/bin/env bun
import { createServer } from "./server.js";

const server = createServer();

// Start the server with stdio transport
server.start();
