import { Hono, type Context } from "hono";
import { MacroFactorClient } from "../core/client.js";
import { loadConfig } from "../config.js";

/**
 * Thin REST adapter over MacroFactorClient.
 *
 *  - GET  routes map to read methods.
 *  - POST routes (JSON body) map to write methods.
 *  - Write routes honor `?dryRun=true` to preview the Firestore payload.
 *
 * The app carries nothing stateful beyond a single shared client instance.
 */
export function createApp(client: MacroFactorClient): Hono {
  const app = new Hono();

  app.get("/health", (c) => c.json({ ok: true, service: "macrofactor-rest" }));

  // --- helpers -----------------------------------------------------------
  const isDryRun = (c: { req: { query: (k: string) => string | undefined } }) =>
    c.req.query("dryRun") === "true" || c.req.query("dryRun") === "1";

  const errorBody = (err: unknown) => ({
    error: err instanceof Error ? err.message : String(err),
  });

  // =======================================================================
  // READ ROUTES (GET)
  // =======================================================================

  app.get("/weight/:year", async (c) => {
    try {
      const year = Number(c.req.param("year"));
      return c.json(await client.getWeightEntries(year));
    } catch (err) {
      return c.json(errorBody(err), 500);
    }
  });

  app.get("/nutrition/:year", async (c) => {
    try {
      const year = Number(c.req.param("year"));
      return c.json(await client.getDailyNutrition(year));
    } catch (err) {
      return c.json(errorBody(err), 500);
    }
  });

  app.get("/steps/:year", async (c) => {
    try {
      const year = Number(c.req.param("year"));
      return c.json(await client.getSteps(year));
    } catch (err) {
      return c.json(errorBody(err), 500);
    }
  });

  app.get("/food/:date", async (c) => {
    try {
      return c.json(await client.getFoodLog(c.req.param("date")));
    } catch (err) {
      return c.json(errorBody(err), 500);
    }
  });

  app.get("/workouts", async (c) => {
    try {
      return c.json(await client.getWorkouts());
    } catch (err) {
      return c.json(errorBody(err), 500);
    }
  });

  app.get("/workouts/:id", async (c) => {
    try {
      const workout = await client.getWorkout(c.req.param("id"));
      return workout ? c.json(workout) : c.json({ error: "not found" }, 404);
    } catch (err) {
      return c.json(errorBody(err), 500);
    }
  });

  app.get("/training-programs", async (c) => {
    try {
      return c.json(await client.getTrainingPrograms());
    } catch (err) {
      return c.json(errorBody(err), 500);
    }
  });

  app.get("/custom-exercises", async (c) => {
    try {
      return c.json(await client.getCustomExercises());
    } catch (err) {
      return c.json(errorBody(err), 500);
    }
  });

  app.get("/custom-workouts", async (c) => {
    try {
      return c.json(await client.getCustomWorkouts());
    } catch (err) {
      return c.json(errorBody(err), 500);
    }
  });

  app.get("/gyms", async (c) => {
    try {
      return c.json(await client.getGyms());
    } catch (err) {
      return c.json(errorBody(err), 500);
    }
  });

  app.get("/profiles/workout", async (c) => {
    try {
      return c.json(await client.getWorkoutProfile());
    } catch (err) {
      return c.json(errorBody(err), 500);
    }
  });

  app.get("/profiles/diet", async (c) => {
    try {
      return c.json(await client.getDietProfile());
    } catch (err) {
      return c.json(errorBody(err), 500);
    }
  });

  // =======================================================================
  // WRITE ROUTES (POST) — honor ?dryRun=true
  // =======================================================================

  const write =
    (method: (input: unknown, opts: { dryRun: boolean }) => Promise<unknown>) =>
    async (c: Context) => {
      try {
        const body = await c.req.json().catch(() => ({}));
        const result = await method(body, { dryRun: isDryRun(c) });
        return c.json(result as object);
      } catch (err) {
        return c.json(errorBody(err), 400);
      }
    };

  app.post("/weight", write((i, o) => client.recordWeight(i, o)));
  app.post("/steps", write((i, o) => client.recordSteps(i, o)));
  app.post("/food", write((i, o) => client.logFood(i, o)));
  app.post("/nutrition", write((i, o) => client.setDailyNutrition(i, o)));
  app.post("/workouts", write((i, o) => client.logWorkout(i, o)));
  app.post("/training-programs", write((i, o) => client.createTrainingProgram(i, o)));
  app.post("/custom-workouts", write((i, o) => client.createCustomWorkout(i, o)));
  app.post("/custom-exercises", write((i, o) => client.createCustomExercise(i, o)));

  return app;
}

/** Builds a client from env config and returns the Hono app + resolved port. */
export function buildAppFromEnv(): { app: Hono; port: number } {
  const config = loadConfig();
  const client = new MacroFactorClient({
    refreshToken: config.refreshToken,
    firebaseApiKey: config.firebaseApiKey,
    mutationLogPath: config.mutationLogPath,
  });
  return { app: createApp(client), port: config.port };
}
