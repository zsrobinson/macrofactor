import type { TokenManager } from "./auth.js";

/**
 * Low-level, typed Firestore REST client for the `sbs-diet-app` project.
 *
 * Handles:
 *  - authed GET (read a document / list a collection)
 *  - authed PATCH (set/merge a document) and POST (create a document)
 *  - conversion between Firestore's typed "Value" JSON and plain JS values,
 *    in both directions.
 *
 * All requests carry a Bearer idToken sourced from the TokenManager.
 */

export const FIRESTORE_BASE =
  "https://firestore.googleapis.com/v1/projects/sbs-diet-app/databases/(default)/documents";

// ---------------------------------------------------------------------------
// Firestore typed-Value representation
// ---------------------------------------------------------------------------

export type FirestoreValue =
  | { nullValue: null }
  | { booleanValue: boolean }
  | { integerValue: string }
  | { doubleValue: number }
  | { stringValue: string }
  | { timestampValue: string }
  | { bytesValue: string }
  | { referenceValue: string }
  | { geoPointValue: { latitude: number; longitude: number } }
  | { mapValue: { fields?: Record<string, FirestoreValue> } }
  | { arrayValue: { values?: FirestoreValue[] } };

export interface FirestoreDocument {
  name?: string;
  fields?: Record<string, FirestoreValue>;
  createTime?: string;
  updateTime?: string;
}

/** A JS value that carries an explicit Firestore timestamp semantics tag. */
export class Timestamp {
  constructor(public readonly iso: string) {}
}

/** Marks a number that must be written as a Firestore `integerValue`. */
export class IntegerValue {
  constructor(public readonly value: number) {}
}

/** Heuristic: ISO-8601 timestamp detector for round-tripping timestampValue. */
const ISO_TIMESTAMP_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

/** Converts a single plain JS value into a Firestore typed Value. */
export function toFirestoreValue(input: unknown): FirestoreValue {
  if (input === null || input === undefined) {
    return { nullValue: null };
  }
  if (input instanceof Timestamp) {
    return { timestampValue: input.iso };
  }
  if (input instanceof IntegerValue) {
    return { integerValue: String(Math.trunc(input.value)) };
  }
  switch (typeof input) {
    case "boolean":
      return { booleanValue: input };
    case "string":
      // NOTE: we deliberately do NOT auto-coerce ISO-looking strings to
      // timestampValue on write — MacroFactor stores some dates as plain
      // strings. Wrap in `new Timestamp(...)` to force a timestampValue.
      return { stringValue: input };
    case "number":
      return Number.isInteger(input)
        ? { doubleValue: input } // default numbers to double; use IntegerValue to force int
        : { doubleValue: input };
    case "bigint":
      return { integerValue: input.toString() };
    case "object": {
      if (Array.isArray(input)) {
        return { arrayValue: { values: input.map(toFirestoreValue) } };
      }
      return { mapValue: { fields: toFirestoreFields(input as Record<string, unknown>) } };
    }
    default:
      throw new Error(`Cannot serialize value of type ${typeof input} to Firestore.`);
  }
}

/** Converts a plain JS object into a Firestore `fields` map. */
export function toFirestoreFields(
  obj: Record<string, unknown>,
): Record<string, FirestoreValue> {
  const fields: Record<string, FirestoreValue> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined) continue; // omit undefined (Firestore has no "undefined")
    fields[key] = toFirestoreValue(value);
  }
  return fields;
}

/** Converts a single Firestore typed Value back into a plain JS value. */
export function fromFirestoreValue(value: FirestoreValue): unknown {
  if ("nullValue" in value) return null;
  if ("booleanValue" in value) return value.booleanValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return value.doubleValue;
  if ("timestampValue" in value) return value.timestampValue;
  if ("bytesValue" in value) return value.bytesValue;
  if ("referenceValue" in value) return value.referenceValue;
  if ("geoPointValue" in value) return value.geoPointValue;
  if ("stringValue" in value) return value.stringValue;
  if ("arrayValue" in value) {
    return (value.arrayValue.values ?? []).map(fromFirestoreValue);
  }
  if ("mapValue" in value) {
    return fromFirestoreFields(value.mapValue.fields ?? {});
  }
  throw new Error(`Unknown Firestore value shape: ${JSON.stringify(value)}`);
}

/** Converts a Firestore `fields` map back into a plain JS object. */
export function fromFirestoreFields(
  fields: Record<string, FirestoreValue>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    out[key] = fromFirestoreValue(value);
  }
  return out;
}

/** Unwraps a whole Firestore document into `{ ...fields }` (or null if empty). */
export function documentToObject(
  doc: FirestoreDocument | null | undefined,
): Record<string, unknown> | null {
  if (!doc || !doc.fields) return null;
  return fromFirestoreFields(doc.fields);
}

/** Extracts the trailing path segment (document id) from a Firestore `name`. */
export function documentId(doc: FirestoreDocument): string | undefined {
  if (!doc.name) return undefined;
  const parts = doc.name.split("/");
  return parts[parts.length - 1];
}

// ---------------------------------------------------------------------------
// REST transport
// ---------------------------------------------------------------------------

export interface FirestoreClientOptions {
  tokens: TokenManager;
  /** Injectable for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Override the Firestore base URL (tests). */
  baseUrl?: string;
}

export class FirestoreClient {
  private readonly tokens: TokenManager;
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;

  constructor(opts: FirestoreClientOptions) {
    this.tokens = opts.tokens;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.baseUrl = opts.baseUrl ?? FIRESTORE_BASE;
  }

  private async authHeaders(): Promise<Record<string, string>> {
    const idToken = await this.tokens.getIdToken();
    return {
      Authorization: `Bearer ${idToken}`,
      "Content-Type": "application/json",
    };
  }

  private url(docPath: string, query?: URLSearchParams): string {
    const clean = docPath.replace(/^\/+/, "");
    const base = `${this.baseUrl}/${clean}`;
    return query && [...query.keys()].length > 0 ? `${base}?${query.toString()}` : base;
  }

  private async handle(res: Response, context: string): Promise<unknown> {
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Firestore ${context} failed: ${res.status} ${res.statusText}. ${text}`.trim());
    }
    if (res.status === 204) return null;
    return res.json();
  }

  /** Reads a single document. Returns null on 404. */
  async getDocument(docPath: string): Promise<FirestoreDocument | null> {
    const res = await this.fetchImpl(this.url(docPath), {
      method: "GET",
      headers: await this.authHeaders(),
    });
    if (res.status === 404) return null;
    return (await this.handle(res, `GET ${docPath}`)) as FirestoreDocument;
  }

  /** Reads a document and unwraps it to a plain object (null if absent/empty). */
  async readObject(docPath: string): Promise<Record<string, unknown> | null> {
    return documentToObject(await this.getDocument(docPath));
  }

  /**
   * Lists documents in a collection, following pagination. `collectionPath` is
   * relative to the Firestore base, e.g. `users/{uid}/workoutHistory`.
   */
  async listCollection(
    collectionPath: string,
    opts: { pageSize?: number } = {},
  ): Promise<FirestoreDocument[]> {
    const results: FirestoreDocument[] = [];
    let pageToken: string | undefined;
    do {
      const query = new URLSearchParams();
      query.set("pageSize", String(opts.pageSize ?? 300));
      if (pageToken) query.set("pageToken", pageToken);
      const res = await this.fetchImpl(this.url(collectionPath, query), {
        method: "GET",
        headers: await this.authHeaders(),
      });
      const data = (await this.handle(res, `LIST ${collectionPath}`)) as {
        documents?: FirestoreDocument[];
        nextPageToken?: string;
      };
      if (data.documents) results.push(...data.documents);
      pageToken = data.nextPageToken;
    } while (pageToken);
    return results;
  }

  /**
   * Sets/merges a document via PATCH. When `updateMask` is provided, only those
   * top-level field paths are written (merge); otherwise the whole document is
   * replaced with `fields`.
   */
  async patchDocument(
    docPath: string,
    fields: Record<string, FirestoreValue>,
    updateMask?: string[],
  ): Promise<FirestoreDocument> {
    const query = new URLSearchParams();
    if (updateMask) {
      for (const path of updateMask) query.append("updateMask.fieldPaths", path);
    }
    const res = await this.fetchImpl(this.url(docPath, query), {
      method: "PATCH",
      headers: await this.authHeaders(),
      body: JSON.stringify({ fields }),
    });
    return (await this.handle(res, `PATCH ${docPath}`)) as FirestoreDocument;
  }

  /**
   * Creates a document in a collection via POST. If `documentId` is given, that
   * id is used; otherwise Firestore auto-generates one.
   */
  async createDocument(
    collectionPath: string,
    fields: Record<string, FirestoreValue>,
    documentId?: string,
  ): Promise<FirestoreDocument> {
    const query = new URLSearchParams();
    if (documentId) query.set("documentId", documentId);
    const res = await this.fetchImpl(this.url(collectionPath, query), {
      method: "POST",
      headers: await this.authHeaders(),
      body: JSON.stringify({ fields }),
    });
    return (await this.handle(res, `POST ${collectionPath}`)) as FirestoreDocument;
  }

  /** Deletes a document. */
  async deleteDocument(docPath: string): Promise<void> {
    const res = await this.fetchImpl(this.url(docPath), {
      method: "DELETE",
      headers: await this.authHeaders(),
    });
    await this.handle(res, `DELETE ${docPath}`);
  }
}

/**
 * Quotes a Firestore field path segment for use in an updateMask when it is not
 * a simple identifier (e.g. the `MMDD` map keys like "0318", which start with a
 * digit, or ISO dates containing "-"). Simple identifiers are left unquoted.
 */
export function quoteFieldPath(segment: string): string {
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(segment)) return segment;
  return "`" + segment.replace(/\\/g, "\\\\").replace(/`/g, "\\`") + "`";
}
