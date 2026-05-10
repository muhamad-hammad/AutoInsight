import { type NextRequest } from "next/server";

const BACKEND = process.env.BACKEND_URL ?? "http://localhost:8000";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ datasetId: string }> }
) {
  const { datasetId } = await params;
  const upstream = await fetch(`${BACKEND}/api/profile/${datasetId}`, {
    headers: { Accept: "text/event-stream" },
    cache: "no-store",
    signal: req.signal,
  });

  if (!upstream.ok || !upstream.body) {
    return new Response(
      JSON.stringify({ message: "Backend unavailable" }),
      { status: upstream.status || 502, headers: { "Content-Type": "application/json" } }
    );
  }

  // Stream body directly — do not buffer
  const { readable, writable } = new TransformStream();
  upstream.body.pipeTo(writable).catch(() => {});

  return new Response(readable, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
