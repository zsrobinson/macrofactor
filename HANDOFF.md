# MacroFactor Integration — Handoff

A personal, unofficial client for the owner's **own** MacroFactor account. Exposes
the owner's nutrition + workout data (read **and** write) through two surfaces
over one shared core: a REST API and an MCP server.

- **Repo:** `zsrobinson/macrofactor`
- **Working branch:** `claude/adoring-ritchie-f7d8v3` (continues `claude/charming-sagan-9wv0ud`)
- **Scope:** personal use, the owner's own data, unofficial (MacroFactor has no public API).

---

## Current status

Validation probe **ran on 2026-10-05**. Result: **token refresh works; Firestore reads
are denied (403).** Option B as designed is blocked at the data layer, not at auth.
See "Probe results" below before doing anything else.

---

## Probe results (2026-10-05)

| Step | Outcome |
|---|---|
| 1. Token refresh | ✅ **Works** — after one fix (below). Returns a 1h `idToken` (`aud=sbs-diet-app`, `sign_in_provider=password`, `email_verified=true`, RevenueCat entitlements present) and rotates the refresh token. Securetoken is **not** App Check–gated. |
| 2. Read | ❌ **403 `Missing or insufficient permissions`** on every path tried: `users/{uid}` itself, `:listCollectionIds`, `scale/2025`, `scale/2026`, `nutrition`, `steps`, `food/{date}`, `workoutHistory`, `trainingProgram`, etc. |
| 3. Write | ⏭️ Not attempted — reads are already denied the same way; a write probe would add nothing. |

**The fix for step 1:** the captured API key is an **iOS-restricted** key. Without the
header `X-Ios-Bundle-Identifier: com.sbs.diet` the refresh returns
`403 API_KEY_IOS_APP_BLOCKED`. `TokenManager` now sends it (`iosBundleId` option,
defaults to `com.sbs.diet`, confirmed via Apple's App Store lookup for id 1553503471).
Firestore requests use only the bearer token, so they don't need the header.

**Why we think step 2 is App Check, not paths/rules:**
- A garbage bearer token gets **401** (unauthenticated), so our idToken *is* accepted.
- Wrong project id gets a different, IAM-style 403. The project id is right.
- The owner's **own** `users/{uid}` doc and `listCollectionIds` are denied. Owner-scoped
  security rules would normally allow those, so a path/shape mismatch doesn't explain it.
- With Firestore App Check enforcement turned on, a request without a valid
  `X-Firebase-AppCheck` token is rejected as `PERMISSION_DENIED` before rules are
  evaluated, which matches what we see.

We are **not** forging or replaying App Check tokens (per the original scope).

---

## Why this exists / how auth works

MacroFactor's backend is a Firebase project (`sbs-diet-app`). All user data lives
under Firestore documents at `users/{uid}/...`, reached via the Firestore REST API
with an `Authorization: Bearer <idToken>` header.

The old community clients (e.g. `sjawhar/macrofactor`, `benthecarman/macro-factor-api`)
authenticated by POSTing email/password to the Identity Toolkit sign-in endpoint. That
path is now **App Check–gated** (reports ~May 2026), so scripted sign-in fails with 401.

**Our durable approach (Option B — refresh-token reuse):** the owner captures a
long-lived Firebase **refresh token** once from their own device, and the client
exchanges it for short-lived `idToken`s via the Secure Token endpoint
(`securetoken.googleapis.com/v1/token`) indefinitely. This piggybacks on the owner's
real, attested app login rather than forging App Check tokens. We explicitly are **not**
bypassing App Check.

---

## Blocked on: two environment secrets

These must be set as **environment variables in the cloud environment settings** (title-bar
environment menu → Edit → environment variables). They must never be pasted into chat or
committed. A fresh session picks them up.

| Variable | What it is |
|---|---|
| `MACROFACTOR_REFRESH_TOKEN` | The owner's long-lived Firebase refresh token (the durable secret). |
| `MACROFACTOR_FIREBASE_API_KEY` | The Firebase web API key (`key=` param); an embedded client key, not truly secret, but needed for the refresh call. |

Optional: `PORT` (REST server), `MACROFACTOR_MUTATION_LOG` (default `./mutations.log.jsonl`).

### How the owner captures the token (one-time)

Intercept the owner's own app traffic with mitmproxy:

1. Install mitmproxy; run it once to generate its CA, then `mitmweb`.
2. Set the phone's Wi-Fi HTTP proxy to the computer's LAN IP, port `8080`.
3. Trust (and, on iOS, *enable*) the mitmproxy CA on the phone via `http://mitm.it`.
4. Sign out of MacroFactor and sign back in, so a fresh auth request fires.
5. In the flows, find:
   - `identitytoolkit.googleapis.com/.../accounts:signInWith...` → response JSON has
     `refreshToken`; the request URL's `?key=...` is the Firebase API key. **OR**
   - `securetoken.googleapis.com/v1/token` → body carries `refresh_token`, URL carries `key=`.
6. Remove the proxy and distrust the cert afterward.

---

## The validation probe (do this first, once secrets exist)

Cheap, read-mostly check that confirms the two load-bearing assumptions before any
further build-out:

1. **Token refresh** — construct `TokenManager`, call `getIdToken()` / `getUserId()`.
   A 403 here means the **securetoken refresh endpoint is App Check–gated** → Option B
   is dead, fall back to Option C (drive the real attested client). Confirm this first.
2. **Read** — fetch one weight/scale entry (`getWeightEntries`). Confirms Firestore
   reads work and that the document paths/field shapes match reality.
3. **Write (dryRun first, then one real write)** — `recordWeight(..., { dryRun: true })`
   to inspect the planned mutation, then one real write. A 403 on the real write means
   **writes are separately App Check–gated**; reads may still be fine (read-only fallback).

Record the outcomes in this file or a follow-up note so the next session doesn't repeat them.

---

## Architecture

Single npm package, pure core + two thin adapters. See `README.md` for run instructions.

```
src/
  config.ts          loadConfig(): reads env secrets, throws listing any missing
  core/
    auth.ts          TokenManager — refresh-token → idToken, cache, auto-refresh, uid decode
    firestore.ts     typed Firestore REST read/write, value (de)serialization, updateMask
    schemas.ts       Zod schemas + inferred types + write-input schemas
    client.ts        MacroFactorClient — reads, then clearly-separated writes
  rest/server.ts     Hono app; GET→reads, POST→writes (?dryRun=true), /health
  mcp/server.ts      MCP server (stdio); one tool per client method
bin/rest.ts          starts REST server
bin/mcp.ts           starts MCP server over stdio
```

**Write safety (already built in):** every write method takes `{ dryRun }` (returns the
planned `WriteStep[]` without sending); every real write appends a JSON line to a
gitignored append-only mutation log *before* the request; merges are non-destructive
(updateMask on only the affected map key).

---

## Collections

Grounded in the reverse-engineered reference
(`raw.githubusercontent.com/sjawhar/macrofactor/main/docs/api-reference.md`). All under
`users/{uid}/`.

| Collection | Read | Write method |
|---|---|---|
| Weight/scale (`scale/{YYYY}`) | ✅ | `recordWeight` |
| Daily nutrition (`nutrition/{YYYY}`) | ✅ | `setDailyNutrition` ⚠️ |
| Steps (`steps/{YYYY}`) | ✅ | `recordSteps` |
| Food log (`food/{YYYY-MM-DD}`) | ✅ | `logFood` |
| Workout history (`workoutHistory/{uuid}`) | ✅ | `logWorkout` |
| Training programs (`trainingProgram/{id}`) | ✅ | `createTrainingProgram` |
| Custom/planned workouts (`customWorkouts/{uuid}`) | ✅ | `createCustomWorkout` |
| Custom exercises (`customExercises/{uuid}`) | ✅ | `createCustomExercise` |
| Gym profiles, workout/diet profile | ✅ | — |

---

## Open `TODO(verify)` — need a real token / real responses

1. ~~**auth.ts** — securetoken refresh not App Check–gated~~ ✅ verified (needs iOS bundle header).
2. **Firestore** — reads (and presumably writes) are denied with 403; most likely App Check enforcement. Blocks everything below.
3. **`setDailyNutrition`** ⚠️ — the app computes nutrition dynamically; a manual write
   there may be recomputed/overwritten. Food logging is the real write path.
4. **Food entry id format** — currently `String(Date.now())`; exact format unconfirmed.
5. **recordWeight** — assumes weight stored in preferred unit (usually kg) under key `w`.
6. Loose/passthrough shapes: `CustomExerciseSchema`, `CycleTargetsSchema` (periodized
   targets), `DietProfileSchema` — confirmed against real data later.

---

## Next steps (in order)

1. ~~Owner captures token → sets the two env secrets.~~ Done.
2. ~~Run the validation probe.~~ Done — see "Probe results".
3. **Owner decision needed:** pick a data path that doesn't go through Firestore
   without App Check:
   - **Option C — drive the real attested client** (the app on a device or simulator,
     automated). Heaviest, but read + write.
   - **Export-based, read-only** — use MacroFactor's built-in data export and parse the
     files. Cheap and clearly sanctioned, but manual and no writes.
   - **Ask MacroFactor** whether there's an official/partner API or integration (e.g.
     Apple Health sync covers weight/steps/nutrition totals as a read source).
4. Keep the core (`TokenManager`, schemas, REST/MCP adapters). Swap the transport under
   `MacroFactorClient` to the chosen path.
5. Only after it works end-to-end: decide on a PR (not yet requested).
