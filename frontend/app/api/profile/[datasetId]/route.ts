import { type NextRequest } from "next/server";
import { loadRawCSV } from "@/lib/dataset-store";
import { profileDataset, generateNarrative } from "@/lib/profiler";

/**
 * SSE-streaming profile endpoint.
 *
 * Emits progress events followed by a final "done" event containing the
 * full DataProfile JSON — identical to the Python SSE implementation.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ datasetId: string }> }
) {
  const { datasetId } = await params;
  const llmProvider = req.nextUrl.searchParams.get("llm_provider");
  const llmKey = req.nextUrl.searchParams.get("llm_key");

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: string) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${data}\n\n`));
      };

      try {
        // Stage 1 — loading
        send("progress", JSON.stringify({ stage: "loading", pct: 5 }));

        const csvText = loadRawCSV(datasetId);
        if (!csvText) {
          send(
            "failure",
            JSON.stringify({ message: `Dataset '${datasetId}' not found` })
          );
          controller.close();
          return;
        }

        // Stage 2 — preprocessing
        send("progress", JSON.stringify({ stage: "preprocessing", pct: 20 }));

        // Stage 3 — compute statistics
        let profile = profileDataset(datasetId, csvText);

        send("progress", JSON.stringify({ stage: "stats", pct: 70 }));

        // Stage 4 — LLM narrative
        const narrative = await generateNarrative(
          profile,
          llmProvider,
          llmKey
        );
        profile = { ...profile, narrative };

        send("progress", JSON.stringify({ stage: "llm_insight", pct: 95 }));

        // Done
        send("done", JSON.stringify(profile));
      } catch (err) {
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
