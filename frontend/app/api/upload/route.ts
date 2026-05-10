import { type NextRequest } from "next/server";

const BACKEND = process.env.BACKEND_URL ?? "http://localhost:8000";

export async function POST(req: NextRequest) {
  try {
    const body = await req.formData();
    const upstream = await fetch(`${BACKEND}/api/upload`, {
      method: "POST",
      body,
    });
    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: { "Content-Type": upstream.headers.get("Content-Type") ?? "application/json" },
    });
  } catch {
    return new Response(JSON.stringify({ detail: "Backend unavailable. Make sure the server is running." }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }
}
