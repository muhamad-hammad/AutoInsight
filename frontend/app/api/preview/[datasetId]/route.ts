import { type NextRequest } from "next/server";
import { loadRawCSV, saveRawCSV } from "@/lib/dataset-store";
import { parseCSV } from "@/lib/profiler";

/**
 * POST so the client can include csv_content when /tmp is cold.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ datasetId: string }> }
) {
  const { datasetId } = await params;

  let csvContent: string | undefined;
  try {
    const body = await _req.json();
    csvContent = body.csv_content;
  } catch { /* empty body */ }

  try {
    let csvText = loadRawCSV(datasetId);
    if (!csvText && csvContent) {
      csvText = csvContent;
      saveRawCSV(datasetId, csvText);
    }

    if (!csvText) {
      return Response.json(
        { detail: `Dataset ${datasetId} not found` },
        { status: 404 }
      );
    }

    const { rows } = parseCSV(csvText);

    // Return 6 random rows (matching the Python backend behaviour)
    const sampleSize = Math.min(6, rows.length);
    const shuffled = [...rows].sort(() => Math.random() - 0.5);
    const sample = shuffled.slice(0, sampleSize);

    return Response.json(sample);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Preview failed";
    return Response.json({ detail: message }, { status: 500 });
  }
}
