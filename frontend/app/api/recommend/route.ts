import { type NextRequest } from "next/server";
import { loadRawCSV } from "@/lib/dataset-store";
import { parseCSV } from "@/lib/profiler";
import { buildFeatureMap, recommend, enrichWithLLM } from "@/lib/advisor";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { dataset_id, target_col, llm_provider, llm_key } = body as {
      dataset_id: string;
      target_col: string;
      llm_provider?: string;
      llm_key?: string;
    };

    if (!dataset_id || !target_col) {
      return Response.json(
        { detail: "dataset_id and target_col are required" },
        { status: 400 }
      );
    }

    const csvText = loadRawCSV(dataset_id);
    if (!csvText) {
      return Response.json(
        { detail: `Dataset '${dataset_id}' not found` },
        { status: 404 }
      );
    }

    const { columns, rows } = parseCSV(csvText);

    if (!columns.includes(target_col)) {
      return Response.json(
        {
          detail: `target_col '${target_col}' not found in dataset features`,
        },
        { status: 422 }
      );
    }

    const featureMap = buildFeatureMap(rows, columns, target_col);
    let roadmaps = recommend(featureMap, rows.length);
    roadmaps = await enrichWithLLM(roadmaps, featureMap, llm_provider, llm_key);

    return Response.json(roadmaps);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Recommendation failed";
    return Response.json({ detail: message }, { status: 500 });
  }
}
