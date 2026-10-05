import "dotenv/config";

/**
 * Runtime configuration loaded from environment variables.
 *
 * Secrets are read from the process environment (populated from `.env` via
 * dotenv). Nothing here is ever hardcoded — see `.env.example` for the list of
 * variables.
 */
export interface Config {
  /** Long-lived Firebase refresh token for the user's own MacroFactor account. */
  refreshToken: string;
  /** Firebase Web API key for the `sbs-diet-app` project. */
  firebaseApiKey: string;
  /** Port the REST server binds to. */
  port: number;
  /** Path to the append-only mutation audit log. */
  mutationLogPath: string;
}

const DEFAULT_PORT = 8787;
const DEFAULT_MUTATION_LOG = "./mutations.log.jsonl";

/**
 * Loads and validates configuration from the environment. Throws a clear,
 * actionable error listing every missing required variable.
 */
export function loadConfig(): Config {
  const missing: string[] = [];

  const refreshToken = process.env.MACROFACTOR_REFRESH_TOKEN;
  if (!refreshToken) missing.push("MACROFACTOR_REFRESH_TOKEN");

  const firebaseApiKey = process.env.MACROFACTOR_FIREBASE_API_KEY;
  if (!firebaseApiKey) missing.push("MACROFACTOR_FIREBASE_API_KEY");

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variable(s): ${missing.join(", ")}.\n` +
        `Copy .env.example to .env and fill in the values. See README.md for how ` +
        `to capture your refresh token and Firebase API key.`,
    );
  }

  const port = process.env.PORT ? Number.parseInt(process.env.PORT, 10) : DEFAULT_PORT;
  if (Number.isNaN(port)) {
    throw new Error(`PORT must be a number, got: ${process.env.PORT}`);
  }

  return {
    // The non-null assertions are safe: we pushed to `missing` and threw above.
    refreshToken: refreshToken!,
    firebaseApiKey: firebaseApiKey!,
    port,
    mutationLogPath: process.env.MACROFACTOR_MUTATION_LOG ?? DEFAULT_MUTATION_LOG,
  };
}
