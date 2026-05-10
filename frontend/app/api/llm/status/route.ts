import { getLLMStatus } from "@/lib/llm";

export async function GET() {
  return Response.json(getLLMStatus());
}
