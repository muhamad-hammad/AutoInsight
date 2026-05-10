"use client";

import { useState, useEffect } from "react";
import type { DataProfile } from "@/lib/types";

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

export function useProfile(datasetId: string | null): UseProfileResult {
  const [progress, setProgress] = useState<Progress | null>(null);
  const [profile, setProfile] = useState<DataProfile | null>(null);
  const [status, setStatus] = useState<ProfileStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!datasetId) return;

    setStatus("loading");
    setProgress(null);
    setProfile(null);
    setError(null);

    const llmProvider = localStorage.getItem("ai-llm-provider") || "";
    const llmKey = localStorage.getItem("ai-llm-key") || "";
    const params = new URLSearchParams();
    if (llmProvider) params.append("llm_provider", llmProvider);
    if (llmKey) params.append("llm_key", llmKey);
    
    const url = `/api/profile/${datasetId}${params.toString() ? `?${params.toString()}` : ""}`;
    const es = new EventSource(url);

    es.addEventListener("progress", (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as Progress;
        setProgress(data);
      } catch {
        // ignore malformed events
      }
    });

    es.addEventListener("done", (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as DataProfile;
        setProfile(data);
        setStatus("done");
      } catch {
        setError("Failed to parse profile data");
        setStatus("error");
      } finally {
        es.close();
      }
    });

    es.addEventListener("failure", (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as { message: string };
        setError(data.message || "Profiling failed");
      } catch {
        setError("Profiling failed");
      }
      setStatus("error");
      es.close();
    });

    es.onerror = () => {
      setError("Connection error while profiling dataset");
      setStatus("error");
      es.close();
    };

    return () => es.close();
  }, [datasetId]);

  return { progress, profile, status, error };
}
