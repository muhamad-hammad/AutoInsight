import { type NextRequest } from "next/server";

const BACKEND = process.env.BACKEND_URL ?? "http://localhost:8000";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ datasetId: string }> }
) {
  const { datasetId } = await params;
  try {
    const upstream = await fetch(`${BACKEND}/api/preview/${datasetId}`, {
      cache: "no-store",
      signal: req.signal,
    });
    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: { "Content-Type": upstream.headers.get("Content-Type") ?? "application/json" },
    });
  } catch {
    return new Response(JSON.stringify({ detail: "Backend unavailable." }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }
}
