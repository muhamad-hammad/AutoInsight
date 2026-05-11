import { type NextRequest, NextResponse } from "next/server";
import { generateNarrative } from "@/lib/profiler";
import type { DataProfile } from "@/lib/types";

/**
 * Endpoint for generating an LLM narrative for a specific profile.
 * Separated from the main profiling stream to avoid Vercel's 10s timeout limit.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ datasetId: string }> }
) {
  try {
    const body = await req.json();
    const { profile, llm_provider, llm_key } = body as {
      profile: DataProfile;
      llm_provider?: string;
      llm_key?: string;
    };

    if (!profile) {
      return NextResponse.json({ error: "Missing profile data" }, { status: 400 });
    }

    const narrative = await generateNarrative(profile, llm_provider, llm_key);
    return NextResponse.json({ narrative });
  } catch (err) {
    console.error("Narrative generation error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to generate narrative" },
      { status: 500 }
    );
  }
}
