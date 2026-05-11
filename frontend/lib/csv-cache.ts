/**
 * Retrieve cached CSV content for a dataset from browser storage.
 *
 * Priority: sessionStorage → Cache API.
 *
 * This exists because Vercel's /tmp is isolated per serverless function
 * container — the CSV uploaded in one container won't exist in another.
 * The client caches the CSV after upload and re-sends it with each API
 * call so the server can always access the data.
 */
export async function getCachedCSV(
  datasetId: string
): Promise<string | null> {
  // 1. Try sessionStorage (fastest, same-tab)
  try {
    const text = sessionStorage.getItem(`csv-${datasetId}`);
    if (text) return text;
  } catch {
    // sessionStorage unavailable (SSR / private browsing)
  }

  // 2. Try Cache API (larger capacity, cross-tab)
  try {
    const cache = await caches.open("autoinsight-datasets");
    const resp = await cache.match(`/dataset/${datasetId}`);
    if (resp) return resp.text();
  } catch {
    // Cache API unavailable
  }

  return null;
}
