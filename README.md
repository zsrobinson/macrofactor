# macrofactor

A personal, **unofficial** TypeScript client for your own [MacroFactor](https://macrofactorapp.com/) (by Stronger By Science) nutrition and workout account.

It talks directly to the app's Firebase/Firestore backend (`sbs-diet-app`) over the REST API, and exposes that both as a small HTTP (REST) server and as an [MCP](https://modelcontextprotocol.io) server so you can read and write your own data from scripts or an LLM agent.

> This is a personal tool for **your own account**. It is not affiliated with or endorsed by Stronger By Science / MacroFactor. Field shapes and document paths are reverse-engineered and may change; see **Unverified assumptions** below.

## Layout

A single package with internal folders and two entry points:

```
macrofactor/
├─ src/
│  ├─ core/
│  │   ├─ auth.ts        # TokenManager: refresh-token -> idToken, uid decode, auto-refresh
│  │   ├─ firestore.ts   # Low-level typed Firestore REST read/write + value (de)serialization
│  │   ├─ schemas.ts     # Zod schemas -> inferred types, shared everywhere
│  │   └─ client.ts      # MacroFactorClient: read methods + write methods (clearly split)
│  ├─ rest/server.ts     # Hono app; GET -> read methods, POST -> write methods
│  ├─ mcp/server.ts      # MCP server; one tool per client method, over stdio
│  └─ config.ts          # loads secrets from env (refresh token, firebase api key)
├─ bin/rest.ts           # starts the REST server
├─ bin/mcp.ts            # starts the MCP server over stdio
├─ .env.example
├─ tsconfig.json
├─ package.json
└─ README.md
```

Everything funnels through `MacroFactorClient`. The REST and MCP servers are thin adapters over it, so behavior (validation, dry-run, the mutation audit log) stays in one place.

## Configuration / secrets

Copy `.env.example` to `.env` and fill it in:

| Variable                        | Required | Description                                                                 |
| ------------------------------- | -------- | --------------------------------------------------------------------------- |
| `MACROFACTOR_REFRESH_TOKEN`     | yes      | Long-lived Firebase refresh token for your account.                         |
| `MACROFACTOR_FIREBASE_API_KEY`  | yes      | Firebase Web API key for the `sbs-diet-app` project (a client key).         |
| `PORT`                          | no       | REST server port (default `8787`).                                          |
| `MACROFACTOR_MUTATION_LOG`      | no       | Path to the append-only write audit log (default `./mutations.log.jsonl`).  |

`.env` and `*.log.jsonl` are gitignored. Nothing is ever hardcoded.

### Capturing the refresh token and API key

These are not published anywhere; you capture them once from your own authenticated app session (e.g. with an HTTPS proxy / mitmproxy on your phone, or by inspecting the Firebase requests the app makes):

1. The **Firebase Web API key** is the `?key=...` query parameter on requests to `identitytoolkit.googleapis.com` / `securetoken.googleapis.com`.
2. The **refresh token** is the `refresh_token` returned by the sign-in or token-refresh response. It is long-lived and can be reused.

### How auth works (`TokenManager`)

`TokenManager` exchanges the refresh token for a short-lived `idToken`:

```
POST https://securetoken.googleapis.com/v1/token?key=<FIREBASE_API_KEY>
Content-Type: application/x-www-form-urlencoded

grant_type=refresh_token&refresh_token=<token>
```

The response's `id_token` is cached in memory and auto-refreshed ~60s before expiry. The `user_id` (also decodable as the JWT `sub`) is used to build `users/{uid}/...` document paths. The idToken is sent as `Authorization: Bearer <idToken>` to Firestore.

## Running

Install (requires network — see note at the bottom if it didn't run here):

```bash
npm install
```

Typecheck / build:

```bash
npm run typecheck
npm run build
```

### REST server

```bash
npm run rest          # tsx bin/rest.ts
# or: npm run dev      (watch mode)
```

Then (default port 8787):

```bash
curl http://localhost:8787/health
curl http://localhost:8787/weight/2026
curl http://localhost:8787/food/2026-03-18
curl http://localhost:8787/workouts

# Writes take a JSON body. Preview with ?dryRun=true (returns the Firestore payload, writes nothing):
curl -X POST 'http://localhost:8787/weight?dryRun=true' \
  -H 'content-type: application/json' \
  -d '{"date":"2026-03-18","weightKg":80.1}'

# Drop ?dryRun=true to actually write (and append to the mutation log).
curl -X POST http://localhost:8787/weight \
  -H 'content-type: application/json' \
  -d '{"date":"2026-03-18","weightKg":80.1}'
```

Read routes: `GET /weight/:year`, `/nutrition/:year`, `/steps/:year`, `/food/:date`, `/workouts`, `/workouts/:id`, `/training-programs`, `/custom-exercises`, `/custom-workouts`, `/gyms`, `/profiles/workout`, `/profiles/diet`.

Write routes (POST, JSON body, `?dryRun=true` supported): `/weight`, `/steps`, `/food`, `/nutrition`, `/workouts`, `/training-programs`, `/custom-workouts`, `/custom-exercises`.

### MCP server

Runs over stdio for use by an MCP client (e.g. Claude Desktop, an agent):

```bash
npm run mcp           # tsx bin/mcp.ts
```

Example MCP client config:

```json
{
  "mcpServers": {
    "macrofactor": {
      "command": "npx",
      "args": ["tsx", "bin/mcp.ts"],
      "cwd": "/path/to/macrofactor",
      "env": {
        "MACROFACTOR_REFRESH_TOKEN": "...",
        "MACROFACTOR_FIREBASE_API_KEY": "..."
      }
    }
  }
}
```

One tool is exposed per client method. Read tools (`get_*`) are side-effect free. Write tools (`record_weight`, `log_food`, `log_workout`, ...) are documented as mutating your real account and accept a `dryRun` input.

## Write safety

- **Dry run:** every write method accepts `{ dryRun: true }` (or `?dryRun=true` / a `dryRun` MCP input). It returns the exact Firestore `WriteStep[]` plan that *would* be sent — HTTP method, path, typed `fields` payload, and `updateMask` — and sends nothing.
- **Mutation audit log:** every real write appends one JSON line per Firestore request to `MACROFACTOR_MUTATION_LOG` (default `./mutations.log.jsonl`, gitignored) *before* the request is sent, recording timestamp, method, path, updateMask, and payload.
- **Non-destructive merges:** year-document writes (weight/steps/nutrition) and food-log writes use Firestore `updateMask` so only the single affected map key is touched; other days/entries are preserved. Library registration (training programs, custom workouts) reads the current `workoutLibraryIds` and appends, rather than overwriting.

## Collections modeled

Grounded in the reverse-engineered [API reference](https://github.com/sjawhar/macrofactor/blob/main/docs/api-reference.md):

| Collection                               | Path                               | Read | Write |
| ---------------------------------------- | ---------------------------------- | ---- | ----- |
| Weight / scale entries                   | `users/{uid}/scale/{YYYY}`         | ✅   | ✅    |
| Daily nutrition totals                   | `users/{uid}/nutrition/{YYYY}`     | ✅   | ✅\*  |
| Step counts                              | `users/{uid}/steps/{YYYY}`         | ✅   | ✅    |
| Food log                                 | `users/{uid}/food/{YYYY-MM-DD}`    | ✅   | ✅    |
| Workout history                          | `users/{uid}/workoutHistory/{id}`  | ✅   | ✅    |
| Training programs                        | `users/{uid}/trainingProgram/{id}` | ✅   | ✅    |
| Custom exercises                         | `users/{uid}/customExercises/{id}` | ✅   | ✅    |
| Custom / planned workouts                | `users/{uid}/customWorkouts/{id}`  | ✅   | ✅    |
| Gym profiles                             | `users/{uid}/gym/{id}`             | ✅   | —     |
| Workout / diet profiles                  | `users/{uid}/profiles/{workout,diet}` | ✅ | —     |

\* Nutrition totals are computed dynamically by the app, so a manual write may be recomputed/overwritten.

## Unverified assumptions

The following must be validated once a real refresh token is available. They are also marked with `// TODO(verify)` comments in the source.

- **Auth is not App-Check-gated.** We assume the `securetoken.googleapis.com` refresh endpoint works with just the refresh token + API key (no Firebase App Check token). The reference notes the global *reference* collections (`exercises/`, `muscles/`, ...) return 403 under App Check; we assume per-user `users/{uid}/...` reads/writes with an idToken are **not** separately gated. If they are, requests will 403 and an App Check token will be required.
- **Firestore writes with the idToken are sufficient.** We assume a valid Bearer idToken authorizes writes to `users/{uid}/...` with no additional gate.
- **Map-key `updateMask` quoting.** The `MMDD` and `YYYY-MM-DD`-style map keys are backtick-quoted in `updateMask` field paths (`quoteFieldPath`); confirm Firestore accepts these for merge writes and that numeric-leading keys round-trip.
- **Food entry id format.** Entry ids are described as "timestamp-based"; we default to `String(Date.now())`. The exact format/precision the app expects is unconfirmed.
- **Value types on write.** Steps (`st`) are written as `integerValue`; weights/macros as `doubleValue`. Confirm the app does not require specific int/double typing for other fields.
- **Training program / custom workout write invariants.** We set `programExerciseIdToNote` and `workoutCycleCompletions` to `{}` when absent and append to `workoutLibraryIds`, per the reference's empirically-verified notes — re-verify against a live round-trip.
- **`CycleTargets` / custom exercise shapes.** Modeled permissively (`.passthrough()`); the full field set (from `app_file.json`) is not captured here.

## Install note

If `npm install` could not run in the environment where this was scaffolded (no network), the dependency versions in `package.json` are still correct — run `npm install` yourself before `npm run typecheck`.
