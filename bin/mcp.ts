#!/usr/bin/env node
import { startStdio } from "../src/mcp/server.js";

/** Entry point: starts the MCP server over stdio. */
startStdio().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Failed to start MacroFactor MCP server:", err);
  process.exit(1);
});
