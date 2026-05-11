import { type NextRequest } from "next/server";
import { loadRawCSV, saveRawCSV } from "@/lib/dataset-store";
import { profileDataset, generateNarrative } from "@/lib/profiler";

/**
 * SSE-streaming profile endpoint.
 *
 * Accepts POST with optional `csv_content` in the JSON body.  If the CSV
 * is not found in /tmp (common on Vercel when a different function
 * container handles this request), it falls back to the client-supplied
 * content and re-saves it to /tmp for the duration of this invocation.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ datasetId: string }> }
) {
  const { datasetId } = await params;

  let body: {
    csv_content?: string;
    llm_provider?: string;
    llm_key?: string;
  } = {};
  try {
    body = await req.json();
  } catch {
    // empty body is fine — we'll try /tmp
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: string) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${data}\n\n`));
      };

      try {
        // Stage 1 — loading
        send("progress", JSON.stringify({ stage: "loading", pct: 5 }));

        // Try /tmp first, fall back to client-supplied CSV
        let csvText = loadRawCSV(datasetId);
        if (!csvText && body.csv_content) {
          csvText = body.csv_content;
          // Re-save so preview / recommend on the same container can find it
          saveRawCSV(datasetId, csvText);
        }

        if (!csvText) {
          send(
            "failure",
            JSON.stringify({ message: `Dataset '${datasetId}' not found` })
          );
          controller.close();
          return;
        }

        // Stage 2 — preprocessing
        send("progress", JSON.stringify({ stage: "preprocessing", pct: 15 }));

        // Stage 3 — compute statistics
        send("progress", JSON.stringify({ stage: "stats", pct: 30 }));
        let profile = profileDataset(datasetId, csvText);

        // Stage 4 — LLM narrative
        send("progress", JSON.stringify({ stage: "llm_insight", pct: 75 }));
        const narrative = await generateNarrative(
          profile,
          body.llm_provider,
          body.llm_key
        );
        profile = { ...profile, narrative };

        // Final check: if profile is too large (Vercel limit 4.5MB), prune correlation matrix
        // A rough estimate: 100 features = 10k pairs. 500 features = 250k pairs.
        if (profile.feature_count > 300) {
          // Keep only high correlations or empty matrix to save space
          profile.correlation_matrix = {};
        }

        send("progress", JSON.stringify({ stage: "llm_insight", pct: 95 }));

        // Done
        send("done", JSON.stringify(profile));
      } catch (err) {
        console.error("Profiling Error:", err);
        const message =
          err instanceof Error ? err.message : "Profiling failed";
        send("failure", JSON.stringify({ message }));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
