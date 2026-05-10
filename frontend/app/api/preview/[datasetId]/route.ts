import { type NextRequest } from "next/server";
import { loadRawCSV } from "@/lib/dataset-store";
import { parseCSV } from "@/lib/profiler";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ datasetId: string }> }
) {
  const { datasetId } = await params;

  try {
    const csvText = loadRawCSV(datasetId);
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
