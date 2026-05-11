"use client";

import { useState, useEffect } from "react";
import type { DataProfile } from "@/lib/types";
import { getCachedCSV } from "@/lib/csv-cache";

export interface Progress {
  stage: string;
  pct: number;
  message?: string;
}

export type ProfileStatus = "idle" | "loading" | "done" | "error";

export interface UseProfileResult {
  progress: Progress | null;
  profile: DataProfile | null;
  status: ProfileStatus;
  error: string | null;
}

/**
 * Streams the profiling SSE endpoint via fetch (POST) so we can include
 * the cached CSV content in the request body.  EventSource only supports
 * GET, which can't carry a body.
 */
export function useProfile(datasetId: string | null): UseProfileResult {
  const [progress, setProgress] = useState<Progress | null>(null);
  const [profile, setProfile] = useState<DataProfile | null>(null);
  const [status, setStatus] = useState<ProfileStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!datasetId) return;

    let cancelled = false;

    setStatus("loading");
    setProgress(null);
    setProfile(null);
    setError(null);

    (async () => {
      try {
        const llmProvider = localStorage.getItem("ai-llm-provider") || "";
        const llmKey = localStorage.getItem("ai-llm-key") || "";
        const csvContent = await getCachedCSV(datasetId);

        const res = await fetch(`/api/profile/${datasetId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            csv_content: csvContent,
            llm_provider: llmProvider || undefined,
            llm_key: llmKey || undefined,
          }),
        });

        if (!res.ok || !res.body) {
          if (!cancelled) {
            setError(`Profiling failed (${res.status})`);
            setStatus("error");
          }
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done || cancelled) break;

          buffer += decoder.decode(value, { stream: true });

          // Parse SSE frames from the buffer
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? ""; // keep incomplete last line

          let currentEvent = "";
          for (const line of lines) {
            if (line.startsWith("event: ")) {
              currentEvent = line.slice(7).trim();
            } else if (line.startsWith("data: ")) {
              const data = line.slice(6);
              if (cancelled) break;

              if (currentEvent === "progress") {
                try {
                  setProgress(JSON.parse(data) as Progress);
                } catch { /* ignore */ }
              } else if (currentEvent === "done") {
                try {
                  setProfile(JSON.parse(data) as DataProfile);
                  setStatus("done");
                } catch {
                  setError("Failed to parse profile data");
                  setStatus("error");
                }
                return; // stream complete
              } else if (currentEvent === "failure") {
                try {
                  const msg = JSON.parse(data) as { message: string };
                  setError(msg.message || "Profiling failed");
                } catch {
                  setError("Profiling failed");
                }
                setStatus("error");
                return;
              }
            }
          }
        }
      } catch {
        if (!cancelled) {
          setError("Connection error while profiling dataset");
          setStatus("error");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [datasetId]);

  return { progress, profile, status, error };
}
