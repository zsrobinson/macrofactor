import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z, type ZodRawShape } from "zod";
import { MacroFactorClient } from "../core/client.js";
import { loadConfig } from "../config.js";
import {
  CustomExerciseSchema,
  CustomWorkoutSchema,
  LogFoodInputSchema,
  RecordStepsInputSchema,
  RecordWeightInputSchema,
  SetDailyNutritionInputSchema,
  TrainingProgramSchema,
  WorkoutHistorySchema,
} from "../core/schemas.js";

/**
 * MCP adapter over MacroFactorClient. Exposes one tool per client method over
 * stdio. Read tools are side-effect free; write tools are clearly named,
 * documented as mutating the user's REAL account, and support a `dryRun` input
 * that returns the Firestore payload without writing.
 *
 * Input schemas are derived from the shared Zod schemas where possible.
 */

const DRY_RUN_SHAPE = {
  dryRun: z
    .boolean()
    .optional()
    .describe("If true, return the Firestore payload that WOULD be written, without writing."),
} satisfies ZodRawShape;

/** JSON text content helper. */
function jsonContent(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

export function createMcpServer(client: MacroFactorClient): McpServer {
  const server = new McpServer({ name: "macrofactor", version: "0.1.0" });

  // =======================================================================
  // READ TOOLS
  // =======================================================================

  server.registerTool(
    "get_weight_entries",
    {
      title: "Get weight entries",
      description: "Read body-weight / scale entries for a calendar year.",
      inputSchema: { year: z.number().int().describe("Calendar year, e.g. 2026") },
    },
    async ({ year }) => jsonContent(await client.getWeightEntries(year)),
  );

  server.registerTool(
    "get_daily_nutrition",
    {
      title: "Get daily nutrition totals",
      description: "Read per-day calorie/macro totals for a calendar year.",
      inputSchema: { year: z.number().int().describe("Calendar year, e.g. 2026") },
    },
    async ({ year }) => jsonContent(await client.getDailyNutrition(year)),
  );

  server.registerTool(
    "get_steps",
    {
      title: "Get step counts",
      description: "Read per-day step counts for a calendar year.",
      inputSchema: { year: z.number().int().describe("Calendar year, e.g. 2026") },
    },
    async ({ year }) => jsonContent(await client.getSteps(year)),
  );

  server.registerTool(
    "get_food_log",
    {
      title: "Get food log for a day",
      description: "Read all food entries logged on a given date (YYYY-MM-DD).",
      inputSchema: { date: z.string().describe("Date as YYYY-MM-DD") },
    },
    async ({ date }) => jsonContent(await client.getFoodLog(date)),
  );

  server.registerTool(
    "get_workouts",
    {
      title: "Get workout history",
      description: "List all completed workout sessions.",
      inputSchema: {},
    },
    async () => jsonContent(await client.getWorkouts()),
  );

  server.registerTool(
    "get_workout",
    {
      title: "Get a workout",
      description: "Read a single completed workout by its id.",
      inputSchema: { id: z.string().describe("Workout history document id (UUID)") },
    },
    async ({ id }) => jsonContent(await client.getWorkout(id)),
  );

  server.registerTool(
    "get_training_programs",
    {
      title: "Get training programs",
      description: "List all training program definitions.",
      inputSchema: {},
    },
    async () => jsonContent(await client.getTrainingPrograms()),
  );

  server.registerTool(
    "get_custom_exercises",
    {
      title: "Get custom exercises",
      description: "List all user-created exercises.",
      inputSchema: {},
    },
    async () => jsonContent(await client.getCustomExercises()),
  );

  server.registerTool(
    "get_custom_workouts",
    {
      title: "Get planned workouts",
      description: "List all queued/planned workouts from the library tab.",
      inputSchema: {},
    },
    async () => jsonContent(await client.getCustomWorkouts()),
  );

  server.registerTool(
    "get_gyms",
    {
      title: "Get gym profiles",
      description: "List all gym profiles.",
      inputSchema: {},
    },
    async () => jsonContent(await client.getGyms()),
  );

  server.registerTool(
    "get_workout_profile",
    {
      title: "Get workout profile",
      description: "Read the workout app settings document (profiles/workout).",
      inputSchema: {},
    },
    async () => jsonContent(await client.getWorkoutProfile()),
  );

  server.registerTool(
    "get_diet_profile",
    {
      title: "Get diet profile",
      description: "Read the diet app settings document (profiles/diet).",
      inputSchema: {},
    },
    async () => jsonContent(await client.getDietProfile()),
  );

  // =======================================================================
  // WRITE TOOLS — these MUTATE the user's real MacroFactor account.
  // =======================================================================

  const WRITE_WARNING = "WRITE: mutates your real MacroFactor account. Pass dryRun=true to preview.";

  server.registerTool(
    "record_weight",
    {
      title: "Record weight",
      description: `${WRITE_WARNING} Records a body-weight (and optional body-fat) entry for a date.`,
      inputSchema: { ...RecordWeightInputSchema.shape, ...DRY_RUN_SHAPE },
    },
    async ({ dryRun, ...input }) =>
      jsonContent(await client.recordWeight(input, { dryRun: dryRun ?? false })),
  );

  server.registerTool(
    "record_steps",
    {
      title: "Record steps",
      description: `${WRITE_WARNING} Records a step count for a date.`,
      inputSchema: { ...RecordStepsInputSchema.shape, ...DRY_RUN_SHAPE },
    },
    async ({ dryRun, ...input }) =>
      jsonContent(await client.recordSteps(input, { dryRun: dryRun ?? false })),
  );

  server.registerTool(
    "log_food",
    {
      title: "Log food",
      description: `${WRITE_WARNING} Adds a food entry to a day's food log.`,
      inputSchema: { ...LogFoodInputSchema.shape, ...DRY_RUN_SHAPE },
    },
    async ({ dryRun, ...input }) =>
      jsonContent(await client.logFood(input, { dryRun: dryRun ?? false })),
  );

  server.registerTool(
    "set_daily_nutrition",
    {
      title: "Set daily nutrition totals",
      description: `${WRITE_WARNING} Overwrites the daily nutrition summary for a date. Note: the app may recompute these dynamically.`,
      inputSchema: { ...SetDailyNutritionInputSchema.shape, ...DRY_RUN_SHAPE },
    },
    async ({ dryRun, ...input }) =>
      jsonContent(await client.setDailyNutrition(input, { dryRun: dryRun ?? false })),
  );

  server.registerTool(
    "log_workout",
    {
      title: "Log workout",
      description: `${WRITE_WARNING} Creates a completed workout history document.`,
      inputSchema: { ...WorkoutHistorySchema.shape, ...DRY_RUN_SHAPE },
    },
    async ({ dryRun, ...input }) =>
      jsonContent(await client.logWorkout(input, { dryRun: dryRun ?? false })),
  );

  server.registerTool(
    "create_training_program",
    {
      title: "Create training program",
      description: `${WRITE_WARNING} Creates a training program and registers it in the workout library.`,
      inputSchema: { ...TrainingProgramSchema.shape, ...DRY_RUN_SHAPE },
    },
    async ({ dryRun, ...input }) =>
      jsonContent(await client.createTrainingProgram(input, { dryRun: dryRun ?? false })),
  );

  server.registerTool(
    "create_custom_workout",
    {
      title: "Create planned workout",
      description: `${WRITE_WARNING} Creates a planned workout and registers it in the workout library.`,
      inputSchema: { ...CustomWorkoutSchema.shape, ...DRY_RUN_SHAPE },
    },
    async ({ dryRun, ...input }) =>
      jsonContent(await client.createCustomWorkout(input, { dryRun: dryRun ?? false })),
  );

  server.registerTool(
    "create_custom_exercise",
    {
      title: "Create custom exercise",
      description: `${WRITE_WARNING} Creates a user-defined exercise.`,
      inputSchema: { ...CustomExerciseSchema.shape, ...DRY_RUN_SHAPE },
    },
    async ({ dryRun, ...input }) =>
      jsonContent(await client.createCustomExercise(input, { dryRun: dryRun ?? false })),
  );

  return server;
}

/** Builds a client from env config and returns a connected-ready MCP server. */
export function buildMcpServerFromEnv(): McpServer {
  const config = loadConfig();
  const client = new MacroFactorClient({
    refreshToken: config.refreshToken,
    firebaseApiKey: config.firebaseApiKey,
    mutationLogPath: config.mutationLogPath,
  });
  return createMcpServer(client);
}

/** Starts the MCP server over stdio. */
export async function startStdio(): Promise<void> {
  const server = buildMcpServerFromEnv();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
