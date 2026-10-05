import { appendFile } from "node:fs/promises";
import { TokenManager } from "./auth.js";
import {
  FirestoreClient,
  IntegerValue,
  Timestamp,
  documentId,
  documentToObject,
  fromFirestoreValue,
  quoteFieldPath,
  toFirestoreFields,
  toFirestoreValue,
  type FirestoreValue,
} from "./firestore.js";
import {
  CreateCustomExerciseInputSchema,
  CreateCustomWorkoutInputSchema,
  CreateTrainingProgramInputSchema,
  CustomExerciseSchema,
  CustomWorkoutSchema,
  DietProfileSchema,
  FoodEntrySchema,
  GymProfileSchema,
  LogFoodInputSchema,
  LogWorkoutInputSchema,
  RecordStepsInputSchema,
  RecordWeightInputSchema,
  SetDailyNutritionInputSchema,
  TrainingProgramSchema,
  WorkoutHistorySchema,
  WorkoutProfileSchema,
  type CustomExercise,
  type CustomWorkout,
  type DailyNutrition,
  type DietProfile,
  type FoodLog,
  type GymProfile,
  type StepCount,
  type TrainingProgram,
  type WeightEntry,
  type WorkoutHistory,
  type WorkoutProfile,
  type WriteOptions,
} from "./schemas.js";

/**
 * MacroFactorClient — the single typed entry point to the user's account.
 *
 * Read methods fetch and decode Firestore documents into friendly JS shapes.
 * Write methods are clearly separated below the read methods; each accepts a
 * `{ dryRun }` option and, when not a dry run, appends an audit line to the
 * mutation log before returning.
 */

export interface MacroFactorClientOptions {
  refreshToken: string;
  firebaseApiKey: string;
  /** Path for the append-only mutation audit log. */
  mutationLogPath?: string;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
}

/** A single planned Firestore mutation (what a write would send). */
export interface WriteStep {
  method: "PATCH" | "POST" | "DELETE";
  path: string;
  /** Firestore typed fields payload (absent for DELETE). */
  fields?: Record<string, FirestoreValue>;
  /** updateMask field paths for a merge PATCH, if any. */
  updateMask?: string[];
  description: string;
}

/** Result of a write method. */
export interface WriteResult {
  dryRun: boolean;
  method: string;
  /** The ordered mutations that make up this write. */
  plan: WriteStep[];
  /** Populated only when executed (not a dry run). */
  documents?: Record<string, unknown>[];
}

const DEFAULT_MUTATION_LOG = "./mutations.log.jsonl";

export class MacroFactorClient {
  private readonly tokens: TokenManager;
  private readonly fs: FirestoreClient;
  private readonly mutationLogPath: string;

  constructor(opts: MacroFactorClientOptions) {
    this.tokens = new TokenManager({
      refreshToken: opts.refreshToken,
      firebaseApiKey: opts.firebaseApiKey,
      fetchImpl: opts.fetchImpl,
    });
    this.fs = new FirestoreClient({ tokens: this.tokens, fetchImpl: opts.fetchImpl });
    this.mutationLogPath = opts.mutationLogPath ?? DEFAULT_MUTATION_LOG;
  }

  /** Resolves the base path `users/{uid}` for the authenticated account. */
  private async userBase(): Promise<string> {
    const uid = await this.tokens.getUserId();
    return `users/${uid}`;
  }

  // =========================================================================
  // READ METHODS
  // =========================================================================

  /**
   * Weight / scale entries for a given year. Reads `scale/{year}` (a map keyed
   * by MMDD) and decodes it into dated entries.
   */
  async getWeightEntries(year: number): Promise<WeightEntry[]> {
    const base = await this.userBase();
    const raw = await this.fs.readObject(`${base}/scale/${year}`);
    if (!raw) return [];
    const entries: WeightEntry[] = [];
    for (const [mmdd, value] of Object.entries(raw)) {
      const v = value as Record<string, unknown>;
      if (v == null || typeof v !== "object") continue;
      entries.push({
        date: mmddToDate(year, mmdd),
        weightKg: Number(v["w"]),
        bodyFatPct: v["f"] != null ? Number(v["f"]) : undefined,
        source: v["s"] != null ? String(v["s"]) : undefined,
      });
    }
    return entries.sort((a, b) => a.date.localeCompare(b.date));
  }

  /** Daily nutrition totals for a given year. Reads `nutrition/{year}`. */
  async getDailyNutrition(year: number): Promise<DailyNutrition[]> {
    const base = await this.userBase();
    const raw = await this.fs.readObject(`${base}/nutrition/${year}`);
    if (!raw) return [];
    const out: DailyNutrition[] = [];
    for (const [mmdd, value] of Object.entries(raw)) {
      const v = value as Record<string, unknown>;
      if (v == null || typeof v !== "object") continue;
      out.push({
        date: mmddToDate(year, mmdd),
        calories: Number(v["k"]),
        protein: Number(v["p"]),
        carbs: Number(v["c"]),
        fat: Number(v["f"]),
      });
    }
    return out.sort((a, b) => a.date.localeCompare(b.date));
  }

  /** Step counts for a given year. Reads `steps/{year}`. */
  async getSteps(year: number): Promise<StepCount[]> {
    const base = await this.userBase();
    const raw = await this.fs.readObject(`${base}/steps/${year}`);
    if (!raw) return [];
    const out: StepCount[] = [];
    for (const [mmdd, value] of Object.entries(raw)) {
      const v = value as Record<string, unknown>;
      if (v == null || typeof v !== "object") continue;
      out.push({
        date: mmddToDate(year, mmdd),
        steps: Number(v["st"]),
        source: v["s"] != null ? String(v["s"]) : undefined,
      });
    }
    return out.sort((a, b) => a.date.localeCompare(b.date));
  }

  /**
   * Food log for a single day (`food/{YYYY-MM-DD}`). Returns a map of
   * entryId -> FoodEntry (raw single-letter keys, validated against the schema).
   */
  async getFoodLog(date: string): Promise<FoodLog> {
    const base = await this.userBase();
    const raw = await this.fs.readObject(`${base}/food/${date}`);
    if (!raw) return {};
    const out: FoodLog = {};
    for (const [entryId, value] of Object.entries(raw)) {
      const parsed = FoodEntrySchema.safeParse(value);
      // Keep valid entries; skip anything that doesn't look like a food entry.
      if (parsed.success) out[entryId] = parsed.data;
    }
    return out;
  }

  /** All completed workouts (`workoutHistory` collection). */
  async getWorkouts(): Promise<WorkoutHistory[]> {
    const base = await this.userBase();
    const docs = await this.fs.listCollection(`${base}/workoutHistory`);
    return docs
      .map((d) => WorkoutHistorySchema.safeParse(documentToObject(d)))
      .filter((r): r is { success: true; data: WorkoutHistory } => r.success)
      .map((r) => r.data);
  }

  /** A single workout by id. */
  async getWorkout(id: string): Promise<WorkoutHistory | null> {
    const base = await this.userBase();
    const obj = await this.fs.readObject(`${base}/workoutHistory/${id}`);
    if (!obj) return null;
    return WorkoutHistorySchema.parse(obj);
  }

  /** All training programs (`trainingProgram` collection). */
  async getTrainingPrograms(): Promise<TrainingProgram[]> {
    const base = await this.userBase();
    const docs = await this.fs.listCollection(`${base}/trainingProgram`);
    return docs
      .map((d) => TrainingProgramSchema.safeParse(documentToObject(d)))
      .filter((r): r is { success: true; data: TrainingProgram } => r.success)
      .map((r) => r.data);
  }

  /** All user-created exercises (`customExercises` collection). */
  async getCustomExercises(): Promise<CustomExercise[]> {
    const base = await this.userBase();
    const docs = await this.fs.listCollection(`${base}/customExercises`);
    return docs
      .map((d) => CustomExerciseSchema.safeParse(documentToObject(d)))
      .filter((r): r is { success: true; data: CustomExercise } => r.success)
      .map((r) => r.data);
  }

  /** All queued/planned workouts (`customWorkouts` collection). */
  async getCustomWorkouts(): Promise<CustomWorkout[]> {
    const base = await this.userBase();
    const docs = await this.fs.listCollection(`${base}/customWorkouts`);
    return docs
      .map((d) => CustomWorkoutSchema.safeParse(documentToObject(d)))
      .filter((r): r is { success: true; data: CustomWorkout } => r.success)
      .map((r) => r.data);
  }

  /** Gym profiles (`gym` collection). */
  async getGyms(): Promise<GymProfile[]> {
    const base = await this.userBase();
    const docs = await this.fs.listCollection(`${base}/gym`);
    return docs
      .map((d) => GymProfileSchema.safeParse(documentToObject(d)))
      .filter((r): r is { success: true; data: GymProfile } => r.success)
      .map((r) => r.data);
  }

  /** Workout app settings (`profiles/workout`). */
  async getWorkoutProfile(): Promise<WorkoutProfile | null> {
    const base = await this.userBase();
    const obj = await this.fs.readObject(`${base}/profiles/workout`);
    return obj ? WorkoutProfileSchema.parse(obj) : null;
  }

  /** Diet app settings (`profiles/diet`). */
  async getDietProfile(): Promise<DietProfile | null> {
    const base = await this.userBase();
    const obj = await this.fs.readObject(`${base}/profiles/diet`);
    return obj ? DietProfileSchema.parse(obj) : null;
  }

  // =========================================================================
  // WRITE METHODS
  //
  // Every write accepts `{ dryRun }`. On dryRun it returns the exact Firestore
  // payload(s) that WOULD be sent, without touching the account. On a real
  // write it executes the plan and appends an audit line to the mutation log.
  // =========================================================================

  /** Records a body-weight (and optional body-fat) entry for a date. */
  async recordWeight(
    input: unknown,
    options: WriteOptions = { dryRun: false },
  ): Promise<WriteResult> {
    const { date, weightKg, bodyFatPct, source } = RecordWeightInputSchema.parse(input);
    const base = await this.userBase();
    const { year, mmdd } = splitDate(date);
    // TODO(verify): weight stored in preferred unit (usually kg) under key `w`.
    const entry: Record<string, unknown> = { w: weightKg };
    if (bodyFatPct !== undefined) entry["f"] = bodyFatPct;
    if (source !== undefined) entry["s"] = source;

    const step: WriteStep = {
      method: "PATCH",
      path: `${base}/scale/${year}`,
      fields: { [mmdd]: toFirestoreValue(entry) },
      updateMask: [quoteFieldPath(mmdd)],
      description: `Set weight entry for ${date}`,
    };
    return this.runWrite("recordWeight", [step], options);
  }

  /** Records a step count for a date. */
  async recordSteps(
    input: unknown,
    options: WriteOptions = { dryRun: false },
  ): Promise<WriteResult> {
    const { date, steps, source } = RecordStepsInputSchema.parse(input);
    const base = await this.userBase();
    const { year, mmdd } = splitDate(date);
    // `st` is an integer count; force integerValue.
    const entry: Record<string, unknown> = { st: new IntegerValue(steps) };
    if (source !== undefined) entry["s"] = source;

    const step: WriteStep = {
      method: "PATCH",
      path: `${base}/steps/${year}`,
      fields: { [mmdd]: toFirestoreValue(entry) },
      updateMask: [quoteFieldPath(mmdd)],
      description: `Set step count for ${date}`,
    };
    return this.runWrite("recordSteps", [step], options);
  }

  /**
   * Logs a food entry on a given day. The day document is a map of
   * entryId -> entry; we merge in a single new key.
   */
  async logFood(
    input: unknown,
    options: WriteOptions = { dryRun: false },
  ): Promise<WriteResult> {
    const { date, entry, entryId } = LogFoodInputSchema.parse(input);
    const base = await this.userBase();
    // TODO(verify): entry ids are "timestamp-based"; exact format unconfirmed.
    const id = entryId ?? String(Date.now());

    const step: WriteStep = {
      method: "PATCH",
      path: `${base}/food/${date}`,
      fields: { [id]: toFirestoreValue(entry) },
      updateMask: [quoteFieldPath(id)],
      description: `Add food entry ${id} on ${date}`,
    };
    return this.runWrite("logFood", [step], options);
  }

  /**
   * Overwrites the daily nutrition summary for a date.
   * TODO(verify): the reference notes MacroFactor computes these dynamically,
   * so a manual write here may be recomputed/overwritten by the app.
   */
  async setDailyNutrition(
    input: unknown,
    options: WriteOptions = { dryRun: false },
  ): Promise<WriteResult> {
    const { date, calories, protein, carbs, fat } = SetDailyNutritionInputSchema.parse(input);
    const base = await this.userBase();
    const { year, mmdd } = splitDate(date);
    const entry = { k: calories, p: protein, c: carbs, f: fat };

    const step: WriteStep = {
      method: "PATCH",
      path: `${base}/nutrition/${year}`,
      fields: { [mmdd]: toFirestoreValue(entry) },
      updateMask: [quoteFieldPath(mmdd)],
      description: `Set daily nutrition summary for ${date} (may be recomputed by app)`,
    };
    return this.runWrite("setDailyNutrition", [step], options);
  }

  /** Logs a completed workout as a `workoutHistory` document. */
  async logWorkout(
    input: unknown,
    options: WriteOptions = { dryRun: false },
  ): Promise<WriteResult> {
    const workout = LogWorkoutInputSchema.parse(input);
    const base = await this.userBase();
    const step: WriteStep = {
      method: "PATCH",
      path: `${base}/workoutHistory/${workout.id}`,
      fields: toFirestoreFields(workout as Record<string, unknown>),
      description: `Create workout history ${workout.id} ("${workout.name}")`,
    };
    return this.runWrite("logWorkout", [step], options);
  }

  /**
   * Creates a training program AND registers it in the workout library.
   *
   * Per the reference, the new program id must be appended to
   * `profiles/workout.workoutLibraryIds` for it to appear in the app. We do a
   * read-modify-write of that array as a second step.
   */
  async createTrainingProgram(
    input: unknown,
    options: WriteOptions = { dryRun: false },
  ): Promise<WriteResult> {
    const program = CreateTrainingProgramInputSchema.parse(input);
    const base = await this.userBase();

    const steps: WriteStep[] = [
      {
        method: "PATCH",
        path: `${base}/trainingProgram/${program.id}`,
        fields: toFirestoreFields(program as Record<string, unknown>),
        description: `Create training program ${program.id} ("${program.name}")`,
      },
      await this.libraryAppendStep(base, program.id, "training program"),
    ];
    return this.runWrite("createTrainingProgram", steps, options);
  }

  /**
   * Creates a planned/custom workout AND registers it in the workout library.
   * Same `workoutLibraryIds` requirement as training programs.
   */
  async createCustomWorkout(
    input: unknown,
    options: WriteOptions = { dryRun: false },
  ): Promise<WriteResult> {
    const workout = CreateCustomWorkoutInputSchema.parse(input);
    const base = await this.userBase();

    const steps: WriteStep[] = [
      {
        method: "PATCH",
        path: `${base}/customWorkouts/${workout.id}`,
        fields: toFirestoreFields(workout as Record<string, unknown>),
        description: `Create custom workout ${workout.id} ("${workout.workoutPlan.name}")`,
      },
      await this.libraryAppendStep(base, workout.id, "custom workout"),
    ];
    return this.runWrite("createCustomWorkout", steps, options);
  }

  /** Creates a user-defined exercise. */
  async createCustomExercise(
    input: unknown,
    options: WriteOptions = { dryRun: false },
  ): Promise<WriteResult> {
    const exercise = CreateCustomExerciseInputSchema.parse(input);
    const base = await this.userBase();
    const step: WriteStep = {
      method: "PATCH",
      path: `${base}/customExercises/${exercise.id}`,
      fields: toFirestoreFields(exercise as Record<string, unknown>),
      description: `Create custom exercise ${exercise.id} ("${exercise.name}")`,
    };
    return this.runWrite("createCustomExercise", [step], options);
  }

  // -------------------------------------------------------------------------
  // Write internals
  // -------------------------------------------------------------------------

  /**
   * Builds the PATCH step that appends an id to
   * `profiles/workout.workoutLibraryIds`, preserving existing ids. Reads the
   * current profile so the merge is non-destructive.
   */
  private async libraryAppendStep(
    base: string,
    newId: string,
    kind: string,
  ): Promise<WriteStep> {
    const profile = await this.fs.readObject(`${base}/profiles/workout`);
    const existing = Array.isArray(profile?.["workoutLibraryIds"])
      ? (profile!["workoutLibraryIds"] as unknown[]).map(String)
      : [];
    const next = existing.includes(newId) ? existing : [...existing, newId];
    return {
      method: "PATCH",
      path: `${base}/profiles/workout`,
      fields: { workoutLibraryIds: toFirestoreValue(next) },
      updateMask: ["workoutLibraryIds"],
      description: `Append ${kind} ${newId} to workoutLibraryIds`,
    };
  }

  /**
   * Executes (or, for dryRun, describes) an ordered set of write steps.
   * Real writes are appended to the mutation log, one JSON line per step,
   * BEFORE each request is sent.
   */
  private async runWrite(
    method: string,
    plan: WriteStep[],
    options: WriteOptions,
  ): Promise<WriteResult> {
    const dryRun = options?.dryRun ?? false;
    if (dryRun) {
      return { dryRun: true, method, plan };
    }

    const documents: Record<string, unknown>[] = [];
    for (const step of plan) {
      await this.appendMutationLog(method, step);
      if (step.method === "PATCH") {
        const doc = await this.fs.patchDocument(step.path, step.fields ?? {}, step.updateMask);
        documents.push(documentToObject(doc) ?? {});
      } else if (step.method === "POST") {
        const doc = await this.fs.createDocument(step.path, step.fields ?? {});
        documents.push(documentToObject(doc) ?? {});
      } else if (step.method === "DELETE") {
        await this.fs.deleteDocument(step.path);
        documents.push({ deleted: step.path });
      }
    }
    return { dryRun: false, method, plan, documents };
  }

  /** Appends one audit record to the append-only mutation log. */
  private async appendMutationLog(method: string, step: WriteStep): Promise<void> {
    const record = {
      ts: new Date().toISOString(),
      method,
      httpMethod: step.method,
      path: step.path,
      updateMask: step.updateMask,
      payload: step.fields,
    };
    try {
      await appendFile(this.mutationLogPath, JSON.stringify(record) + "\n", "utf8");
    } catch (err) {
      // A failing audit log must not silently drop the fact that we mutated.
      throw new Error(
        `Failed to append to mutation log at ${this.mutationLogPath}: ${String(err)}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

/** Splits a YYYY-MM-DD string into { year, mmdd } for year-document writes. */
export function splitDate(date: string): { year: number; mmdd: string } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) throw new Error(`Invalid date (expected YYYY-MM-DD): ${date}`);
  return { year: Number(m[1]), mmdd: `${m[2]}${m[3]}` };
}

/** Rebuilds a YYYY-MM-DD string from a year and an MMDD map key. */
export function mmddToDate(year: number, mmdd: string): string {
  const mm = mmdd.slice(0, 2);
  const dd = mmdd.slice(2, 4);
  return `${year}-${mm}-${dd}`;
}

// Re-export helpers consumers may want when building raw payloads.
export { Timestamp, IntegerValue, fromFirestoreValue };
