import { type NextRequest } from "next/server";
import { setRuntimeProvider, getLLMStatus } from "@/lib/llm";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { provider } = body as { provider?: string | null };
    setRuntimeProvider(provider ?? null);
    return Response.json(getLLMStatus());
  } catch {
    return Response.json(
      { detail: "Invalid request body" },
      { status: 400 }
    );
  }
}
