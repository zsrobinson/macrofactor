import { z } from "zod";

/**
 * Zod schemas for MacroFactor Firestore collections, grounded in the
 * reverse-engineered API reference
 * (https://github.com/sjawhar/macrofactor/blob/main/docs/api-reference.md).
 *
 * Field shapes marked TODO(verify) are best-effort guesses that must be
 * confirmed by round-tripping against a real account once a token exists.
 *
 * Firestore stores these with terse single-letter keys. We keep the raw keys in
 * the "raw" schemas (what is actually on the wire) and expose friendlier,
 * decoded shapes from the client where helpful.
 */

// ---------------------------------------------------------------------------
// Scale / Weight entries  — users/{uid}/scale/{YYYY}, map keyed by MMDD
// ---------------------------------------------------------------------------

export const ScaleEntrySchema = z.object({
  w: z.number().describe("Weight (preferred unit, usually kg)"),
  f: z.number().optional().describe("Body fat percentage"),
  s: z.string().optional().describe("Source"),
});
export type ScaleEntry = z.infer<typeof ScaleEntrySchema>;

/** A decoded weight entry with the date attached. */
export const WeightEntrySchema = z.object({
  date: z.string().describe("YYYY-MM-DD"),
  weightKg: z.number(),
  bodyFatPct: z.number().optional(),
  source: z.string().optional(),
});
export type WeightEntry = z.infer<typeof WeightEntrySchema>;

// ---------------------------------------------------------------------------
// Daily nutrition summaries — users/{uid}/nutrition/{YYYY}, map keyed by MMDD
// ---------------------------------------------------------------------------

export const NutritionSummarySchema = z.object({
  k: z.number().describe("Total calories (kcal)"),
  p: z.number().describe("Total protein (g)"),
  c: z.number().describe("Total carbs (g)"),
  f: z.number().describe("Total fat (g)"),
});
export type NutritionSummary = z.infer<typeof NutritionSummarySchema>;

export const DailyNutritionSchema = z.object({
  date: z.string().describe("YYYY-MM-DD"),
  calories: z.number(),
  protein: z.number(),
  carbs: z.number(),
  fat: z.number(),
});
export type DailyNutrition = z.infer<typeof DailyNutritionSchema>;

// ---------------------------------------------------------------------------
// Step counts — users/{uid}/steps/{YYYY}, map keyed by MMDD
// ---------------------------------------------------------------------------

export const StepEntrySchema = z.object({
  st: z.number().describe("Steps taken"),
  s: z.string().optional().describe("Source"),
});
export type StepEntry = z.infer<typeof StepEntrySchema>;

export const StepCountSchema = z.object({
  date: z.string().describe("YYYY-MM-DD"),
  steps: z.number(),
  source: z.string().optional(),
});
export type StepCount = z.infer<typeof StepCountSchema>;

// ---------------------------------------------------------------------------
// Food log — users/{uid}/food/{YYYY-MM-DD}, map keyed by entry id
// ---------------------------------------------------------------------------

export const FoodEntrySchema = z.object({
  t: z.string().optional().describe("Name / title"),
  b: z.string().optional().describe("Brand"),
  c: z.number().optional().describe("Calories per `g` amount"),
  p: z.number().optional().describe("Protein per `g` amount"),
  e: z.number().optional().describe("Carbs per `g` amount"),
  f: z.number().optional().describe("Fat per `g` amount"),
  g: z.number().optional().describe("Serving size in grams"),
  w: z.number().optional().describe("Unit weight"),
  y: z.number().optional().describe("User quantity"),
  q: z.number().optional().describe("Computed quantity"),
  s: z.string().optional().describe("Serving unit string"),
  id: z.string().optional().describe("Global food id (if from search)"),
  h: z.string().optional().describe("Hour of meal, local wall-clock, not zero-padded"),
  mi: z.string().optional().describe("Minute of meal, local wall-clock, not zero-padded"),
  k: z.string().optional().describe('Source type ("search", "manual", ...)'),
  d: z.boolean().optional().describe("True if soft-deleted"),
  x: z.string().optional().describe("Image id / barcode"),
});
export type FoodEntry = z.infer<typeof FoodEntrySchema>;

/** A single day's food log: map of entryId -> FoodEntry. */
export const FoodLogSchema = z.record(z.string(), FoodEntrySchema);
export type FoodLog = z.infer<typeof FoodLogSchema>;

// ---------------------------------------------------------------------------
// Workout history — users/{uid}/workoutHistory/{uuid}
// ---------------------------------------------------------------------------

export const SetLogValueSchema = z.object({
  weight: z.number().describe("kg"),
  fullReps: z.number(),
  partialReps: z.number().nullable().optional(),
  rir: z.number().nullable().optional(),
  restTimer: z.number().describe("microseconds"),
  isSkipped: z.boolean(),
});

export const SetTargetSchema = z.object({
  minFullReps: z.number().nullable(),
  maxFullReps: z.number().nullable(),
  rir: z.number().nullable(),
  restTimer: z.number().nullable().describe("microseconds"),
});

export const WorkoutSetSchema = z.object({
  setType: z.enum(["warmUp", "standard", "failure"]),
  log: z.object({
    id: z.string(),
    runtimeType: z.literal("single"),
    target: SetTargetSchema.nullable(),
    value: SetLogValueSchema,
  }),
});

export const WorkoutExerciseSchema = z.object({
  id: z.string().describe("Instance UUID"),
  exerciseId: z.string().describe("Hex id -> resolve via exercise database"),
  baseWeight: z.number().nullable().optional(),
  note: z.string().optional(),
  sets: z.array(WorkoutSetSchema),
});

export const WorkoutBlockSchema = z.object({
  exercises: z.array(WorkoutExerciseSchema),
});

export const WorkoutSourceSchema = z.object({
  runtimeType: z.literal("program"),
  programId: z.string(),
  programName: z.string(),
  dayId: z.string(),
  cycleIndex: z.number(),
});

export const WorkoutHistorySchema = z.object({
  id: z.string().describe("UUID"),
  name: z.string(),
  startTime: z.string().describe("ISO 8601 timestamp"),
  duration: z.number().describe("microseconds"),
  gymId: z.string().optional(),
  gymName: z.string().optional(),
  gymIcon: z.string().optional(),
  workoutSource: WorkoutSourceSchema.optional(),
  blocks: z.array(WorkoutBlockSchema),
});
export type WorkoutHistory = z.infer<typeof WorkoutHistorySchema>;

// ---------------------------------------------------------------------------
// Gym profiles — users/{uid}/gym/{uuid}
// ---------------------------------------------------------------------------

export const GymProfileSchema = z.object({
  id: z.string(),
  name: z.string(),
  icon: z.string().optional(),
  weightUnit: z.enum(["kgs", "lbs"]).optional(),
  selectedEquipmentIds: z.array(z.string()).optional().describe("Hex ids"),
  alwaysShowExercises: z.array(z.string()).optional().describe("Hex ids"),
  alwaysHideExercises: z.array(z.string()).optional().describe("Hex ids"),
  useBumperPlatesInPlateCalculator: z.boolean().optional(),
  allowMixedUnitsInPlateCalculator: z.boolean().optional(),
  offsetWeightInPlateCalculator: z.number().optional(),
});
export type GymProfile = z.infer<typeof GymProfileSchema>;

// ---------------------------------------------------------------------------
// Training programs — users/{uid}/trainingProgram/{programId}
// ---------------------------------------------------------------------------

// TODO(verify): CycleTargets exact shape not fully documented in the reference.
// Modeled loosely from the periodized target hints; confirm against real data.
export const CycleTargetsSchema = z
  .object({
    setType: z.enum(["standard", "warmUp", "failure"]).optional(),
    minFullReps: z.number().nullable().optional(),
    maxFullReps: z.number().nullable().optional(),
    rir: z.number().nullable().optional(),
    restTimer: z.number().nullable().optional().describe("microseconds"),
  })
  .passthrough();

export const PeriodizedTargetsSchema = z.object({
  runtimeType: z.literal("periodized"),
  values: z.array(CycleTargetsSchema).describe("One entry per cycle"),
  deload: CycleTargetsSchema.nullable(),
});

export const ProgramExerciseSchema = z.object({
  id: z.string().describe("Exercise instance UUID within the program"),
  exerciseId: z.string().describe("32-char hex id"),
  periodizedTargets: PeriodizedTargetsSchema,
});

export const ProgramBlockSchema = z.object({
  id: z.string().optional(),
  exercises: z.array(ProgramExerciseSchema),
});

export const ProgramDaySchema = z.object({
  id: z.string().describe("UUID — matches workoutSource.dayId"),
  name: z.string().describe('e.g. "Workout A" or "---" for rest days'),
  gymId: z.string().describe('UUID — "blankSlate" for rest days'),
  blocks: z.array(ProgramBlockSchema).describe("Empty array for rest days"),
});

export const TrainingProgramSchema = z.object({
  id: z.string().describe("UUID"),
  name: z.string(),
  color: z.string().optional(),
  icon: z.string().optional(),
  numCycles: z.number(),
  runIndefinitely: z.boolean(),
  isPeriodized: z.boolean(),
  deload: z.enum(["lastCycle", "none"]).optional(),
  expanded: z.boolean().optional(),
  // Required-on-write per the reference; default to {} to avoid breaking the app.
  programExerciseIdToNote: z.record(z.string(), z.string()).default({}),
  workoutCycleCompletions: z.record(z.string(), z.unknown()).default({}),
  days: z.array(ProgramDaySchema),
});
export type TrainingProgram = z.infer<typeof TrainingProgramSchema>;

// ---------------------------------------------------------------------------
// Custom exercises — users/{uid}/customExercises/{uuid}
// ---------------------------------------------------------------------------

// TODO(verify): the reference says this follows the same (large) schema as
// bundled exercises in app_file.json (primaryFeatureMuscle,
// resistanceEquipmentGroups, laterality, ...). Modeled permissively until the
// full shape can be captured from a real account.
export const CustomExerciseSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    primaryFeatureMuscle: z.string().optional(),
    laterality: z.string().optional(),
    resistanceEquipmentGroups: z.array(z.unknown()).optional(),
  })
  .passthrough();
export type CustomExercise = z.infer<typeof CustomExerciseSchema>;

// ---------------------------------------------------------------------------
// Custom / planned workouts — users/{uid}/customWorkouts/{uuid}
// ---------------------------------------------------------------------------

export const PlanSetLogSchema = z.object({
  minFullReps: z.number().nullable(),
  maxFullReps: z.number().nullable(),
  rir: z.number().nullable(),
  restTimer: z.number().nullable().describe("microseconds; null = app default"),
  distance: z.number().nullable(),
  durationSeconds: z.number().nullable(),
  weight: z.number().nullable().describe("kg; NOTE: ignored by the app in-session"),
});

export const PlanSetSchema = z.object({
  setType: z.enum(["standard", "warmUp", "failure"]),
  segments: z.array(z.unknown()).describe("Reserved; currently always empty"),
  log: PlanSetLogSchema,
});

export const PlanExerciseSchema = z.object({
  id: z.string(),
  exerciseId: z.string(),
  note: z.string().optional(),
  target: z.object({
    overrideRestTimers: z.boolean(),
    sets: z.array(PlanSetSchema),
  }),
});

export const PlanBlockSchema = z.object({
  id: z.string(),
  exercises: z.array(PlanExerciseSchema),
});

export const CustomWorkoutSchema = z.object({
  id: z.string(),
  workoutPlan: z.object({
    name: z.string(),
    gymId: z.string(),
    blocks: z.array(PlanBlockSchema),
  }),
});
export type CustomWorkout = z.infer<typeof CustomWorkoutSchema>;

// ---------------------------------------------------------------------------
// Profiles — users/{uid}/profiles/workout and /diet
// ---------------------------------------------------------------------------

export const WorkoutProfileSchema = z
  .object({
    activeProgramId: z.string().nullable().optional(),
    gymIds: z.array(z.string()).optional(),
    workoutLibraryIds: z.array(z.string()).optional(),
    userExerciseConfigs: z.record(z.string(), z.unknown()).optional(),
    addSmartWarmUps: z.boolean().optional(),
    useDeload: z.boolean().optional(),
    rirTracking: z.boolean().optional(),
  })
  .passthrough();
export type WorkoutProfile = z.infer<typeof WorkoutProfileSchema>;

// TODO(verify): diet profile is only described as "toolbar/shortcut config".
export const DietProfileSchema = z.record(z.string(), z.unknown());
export type DietProfile = z.infer<typeof DietProfileSchema>;

// ---------------------------------------------------------------------------
// Write-method input schemas (friendly args, validated at the boundary)
// ---------------------------------------------------------------------------

const DateYmd = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD");

export const RecordWeightInputSchema = z.object({
  date: DateYmd,
  weightKg: z.number().positive(),
  bodyFatPct: z.number().optional(),
  source: z.string().optional().default("api"),
});
export type RecordWeightInput = z.infer<typeof RecordWeightInputSchema>;

export const RecordStepsInputSchema = z.object({
  date: DateYmd,
  steps: z.number().int().nonnegative(),
  source: z.string().optional().default("api"),
});
export type RecordStepsInput = z.infer<typeof RecordStepsInputSchema>;

export const LogFoodInputSchema = z.object({
  date: DateYmd,
  /** Optional explicit entry id; defaults to a timestamp-based id. */
  entryId: z.string().optional(),
  entry: FoodEntrySchema,
});
export type LogFoodInput = z.infer<typeof LogFoodInputSchema>;

export const SetDailyNutritionInputSchema = z.object({
  date: DateYmd,
  calories: z.number(),
  protein: z.number(),
  carbs: z.number(),
  fat: z.number(),
});
export type SetDailyNutritionInput = z.infer<typeof SetDailyNutritionInputSchema>;

export const LogWorkoutInputSchema = WorkoutHistorySchema;
export type LogWorkoutInput = z.infer<typeof LogWorkoutInputSchema>;

export const CreateTrainingProgramInputSchema = TrainingProgramSchema;
export type CreateTrainingProgramInput = z.infer<typeof CreateTrainingProgramInputSchema>;

export const CreateCustomWorkoutInputSchema = CustomWorkoutSchema;
export type CreateCustomWorkoutInput = z.infer<typeof CreateCustomWorkoutInputSchema>;

export const CreateCustomExerciseInputSchema = CustomExerciseSchema;
export type CreateCustomExerciseInput = z.infer<typeof CreateCustomExerciseInputSchema>;

/** Options accepted by every write method. */
export const WriteOptionsSchema = z.object({
  dryRun: z.boolean().optional().default(false),
});
export type WriteOptions = z.infer<typeof WriteOptionsSchema>;
