/**
 * TokenManager — durable auth via refresh-token reuse.
 *
 * The user supplies a long-lived Firebase `refreshToken` as a secret. This
 * manager exchanges it for a short-lived `idToken` via the Firebase Secure
 * Token endpoint, caches that idToken in memory, and auto-refreshes shortly
 * before expiry. The user id (`sub`) is decoded from the idToken JWT payload
 * so we can build `users/{uid}/...` document paths.
 *
 * Verified against the live backend: the securetoken refresh endpoint is NOT
 * App Check–gated. The API key captured from the iOS app is, however,
 * restricted to iOS clients, so the refresh must carry the app's bundle id in
 * `X-Ios-Bundle-Identifier` (otherwise 403 API_KEY_IOS_APP_BLOCKED).
 */

const SECURE_TOKEN_URL = "https://securetoken.googleapis.com/v1/token";

/** MacroFactor's iOS bundle id (App Store id 1553503471). */
const DEFAULT_IOS_BUNDLE_ID = "com.sbs.diet";

/** Refresh this many ms before the token actually expires, to avoid races. */
const REFRESH_SKEW_MS = 60_000;

interface SecureTokenResponse {
  access_token?: string;
  expires_in: string; // seconds, as a string
  token_type?: string;
  refresh_token: string;
  id_token: string;
  user_id: string;
  project_id?: string;
}

interface CachedToken {
  idToken: string;
  /** Epoch ms at which we should refresh (actual expiry minus skew). */
  refreshAt: number;
  userId: string;
}

export interface TokenManagerOptions {
  refreshToken: string;
  firebaseApiKey: string;
  /** Sent as `X-Ios-Bundle-Identifier`; required by the iOS-restricted API key. */
  iosBundleId?: string;
  /** Injectable for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

export class TokenManager {
  private readonly firebaseApiKey: string;
  private readonly iosBundleId: string;
  private readonly fetchImpl: typeof fetch;
  private refreshToken: string;
  private cached: CachedToken | null = null;
  /** De-dupes concurrent refreshes. */
  private inFlight: Promise<CachedToken> | null = null;

  constructor(opts: TokenManagerOptions) {
    this.refreshToken = opts.refreshToken;
    this.firebaseApiKey = opts.firebaseApiKey;
    this.iosBundleId = opts.iosBundleId ?? DEFAULT_IOS_BUNDLE_ID;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  /** Returns a valid idToken, refreshing if necessary. */
  async getIdToken(): Promise<string> {
    const token = await this.ensureFresh();
    return token.idToken;
  }

  /** Returns the authenticated user's uid (Firebase `user_id` / JWT `sub`). */
  async getUserId(): Promise<string> {
    const token = await this.ensureFresh();
    return token.userId;
  }

  private async ensureFresh(): Promise<CachedToken> {
    if (this.cached && Date.now() < this.cached.refreshAt) {
      return this.cached;
    }
    if (this.inFlight) return this.inFlight;

    this.inFlight = this.refresh()
      .then((token) => {
        this.cached = token;
        return token;
      })
      .finally(() => {
        this.inFlight = null;
      });

    return this.inFlight;
  }

  private async refresh(): Promise<CachedToken> {
    const url = `${SECURE_TOKEN_URL}?key=${encodeURIComponent(this.firebaseApiKey)}`;
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: this.refreshToken,
    });

    const res = await this.fetchImpl(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Ios-Bundle-Identifier": this.iosBundleId,
      },
      body: body.toString(),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `Token refresh failed: ${res.status} ${res.statusText}. ${text}`.trim(),
      );
    }

    const data = (await res.json()) as SecureTokenResponse;
    if (!data.id_token) {
      throw new Error("Token refresh response did not contain an id_token.");
    }

    // The endpoint rotates refresh tokens; keep the latest for subsequent calls.
    if (data.refresh_token) {
      this.refreshToken = data.refresh_token;
    }

    const expiresInMs = Number.parseInt(data.expires_in ?? "3600", 10) * 1000;
    const userId = data.user_id || decodeJwtSub(data.id_token);
    if (!userId) {
      throw new Error("Could not determine user id from token refresh response.");
    }

    return {
      idToken: data.id_token,
      refreshAt: Date.now() + Math.max(0, expiresInMs - REFRESH_SKEW_MS),
      userId,
    };
  }
}

/**
 * Decodes the `sub` (or `user_id`) claim from a JWT without verifying the
 * signature — we only need the identity to build document paths, and the token
 * came straight from a trusted refresh over TLS.
 */
export function decodeJwtSub(idToken: string): string {
  const payload = decodeJwtPayload(idToken);
  const sub = (payload["sub"] ?? payload["user_id"]) as unknown;
  return typeof sub === "string" ? sub : "";
}

/** Base64url-decodes and parses the payload segment of a JWT. */
export function decodeJwtPayload(idToken: string): Record<string, unknown> {
  const parts = idToken.split(".");
  if (parts.length < 2) {
    throw new Error("Malformed JWT: expected at least two segments.");
  }
  const payloadSegment = parts[1]!;
  const base64 = payloadSegment.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  const json = Buffer.from(padded, "base64").toString("utf8");
  return JSON.parse(json) as Record<string, unknown>;
}
