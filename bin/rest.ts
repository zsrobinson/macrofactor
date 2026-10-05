#!/usr/bin/env node
import { serve } from "@hono/node-server";
import { buildAppFromEnv } from "../src/rest/server.js";

/** Entry point: starts the REST server. */
function main(): void {
  const { app, port } = buildAppFromEnv();
  serve({ fetch: app.fetch, port }, (info) => {
    // eslint-disable-next-line no-console
    console.error(`macrofactor REST server listening on http://localhost:${info.port}`);
  });
}

main();
