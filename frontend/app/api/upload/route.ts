import { randomUUID } from "crypto";
import Papa from "papaparse";
import { type NextRequest } from "next/server";
import { saveRawCSV, saveSchema } from "@/lib/dataset-store";

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MB

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof Blob)) {
      return Response.json(
        { detail: "No file provided" },
        { status: 400 }
      );
    }

    const fileName =
      file instanceof File ? file.name : "upload";

    // Validate file type
    const isCSV =
      fileName.endsWith(".csv") ||
      file.type === "text/csv";
    const isJSON =
      fileName.endsWith(".json") ||
      file.type === "application/json";

    if (!isCSV && !isJSON) {
      return Response.json(
        { detail: "Only .csv or .json files accepted" },
        { status: 400 }
      );
    }

    const contents = await file.text();
    if (contents.length > MAX_FILE_SIZE) {
      return Response.json(
        { detail: "File exceeds 100 MB limit" },
        { status: 413 }
      );
    }

    // If JSON, convert to CSV
    let csvText = contents;
    if (isJSON) {
      try {
        const jsonData = JSON.parse(contents);
        const arr = Array.isArray(jsonData) ? jsonData : [jsonData];
        csvText = Papa.unparse(arr);
      } catch {
        return Response.json(
          { detail: "Could not parse JSON file" },
          { status: 422 }
        );
      }
    }

    // Parse header to get schema
    const parseResult = Papa.parse<Record<string, string>>(csvText, {
      header: true,
      preview: 1, // only read first row for schema
    });

    if (!parseResult.meta.fields || parseResult.meta.fields.length === 0) {
      return Response.json(
        { detail: "Could not parse CSV: no columns found" },
        { status: 422 }
      );
    }

    const datasetId = randomUUID();
    const schema: Record<string, string> = {};
    for (const col of parseResult.meta.fields) {
      schema[col] = "object"; // will be refined during profiling
    }

    // Save to /tmp
    saveRawCSV(datasetId, csvText);
    saveSchema(datasetId, schema);

    return Response.json({ dataset_id: datasetId, schema });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Upload failed";
    return Response.json({ detail: message }, { status: 500 });
  }
}
