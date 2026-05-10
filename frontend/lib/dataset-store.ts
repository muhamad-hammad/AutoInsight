/**
 * Dataset storage utilities.
 *
 * On Vercel serverless functions, `/tmp` is writable but ephemeral — data may
 * persist across warm invocations of the *same* function instance but is not
 * guaranteed between cold starts.  For a portfolio / demo app this is
 * acceptable; for production you'd swap to Vercel Blob or an external DB.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

const DATA_ROOT = join("/tmp", "autoinsight-data");

/** Ensure the root data directory exists. */
function ensureRoot(): void {
  if (!existsSync(DATA_ROOT)) {
    mkdirSync(DATA_ROOT, { recursive: true });
  }
}

/** Return the directory for a given dataset. */
export function datasetDir(datasetId: string): string {
  const dir = join(DATA_ROOT, datasetId);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/** Save raw CSV content for a dataset. */
export function saveRawCSV(datasetId: string, content: string): void {
  ensureRoot();
  const dir = datasetDir(datasetId);
  writeFileSync(join(dir, "raw.csv"), content, "utf-8");
}

/** Load raw CSV content for a dataset. Returns null if not found. */
export function loadRawCSV(datasetId: string): string | null {
  const path = join(DATA_ROOT, datasetId, "raw.csv");
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf-8");
}

/** Save the inferred column schema (col → dtype string). */
export function saveSchema(
  datasetId: string,
  schema: Record<string, string>
): void {
  const dir = datasetDir(datasetId);
  writeFileSync(join(dir, "spec.json"), JSON.stringify(schema, null, 2), "utf-8");
}

/** Load the saved schema. Returns null if not found. */
export function loadSchema(
  datasetId: string
): Record<string, string> | null {
  const path = join(DATA_ROOT, datasetId, "spec.json");
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf-8"));
}

/** Check whether a dataset exists in /tmp. */
export function datasetExists(datasetId: string): boolean {
  return existsSync(join(DATA_ROOT, datasetId, "raw.csv"));
}
