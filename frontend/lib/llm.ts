/**
 * LLM provider configuration & resolution.
 *
 * Environment variables are read server-side from Vercel's env config.
 * The client can also pass provider + key via request params (stored in
 * localStorage on the browser side).
 */

export interface LLMProviderConfig {
  base_url: string;
  key_env: string;
  model_env: string;
  default_model: string;
}

export const LLM_PROVIDERS: Record<string, LLMProviderConfig> = {
  openai: {
    base_url: "https://api.openai.com/v1",
    key_env: "OPENAI_API_KEY",
    model_env: "OPENAI_MODEL",
    default_model: "gpt-4o-mini",
  },
  openrouter: {
    base_url: "https://openrouter.ai/api/v1",
    key_env: "OPENROUTER_API_KEY",
    model_env: "OPENROUTER_MODEL",
    default_model: "meta-llama/llama-3.3-8b-instruct:free",
  },
  gemini: {
    base_url: "https://generativelanguage.googleapis.com/v1beta/openai",
    key_env: "GEMINI_API_KEY",
    model_env: "GEMINI_MODEL",
    default_model: "gemini-2.0-flash",
  },
  grok: {
    base_url: "https://api.x.ai/v1",
    key_env: "XAI_API_KEY",
    model_env: "GROK_MODEL",
    default_model: "grok-3-mini",
  },
  groq: {
    base_url: "https://api.groq.com/openai/v1",
    key_env: "GROQ_API_KEY",
    model_env: "GROQ_MODEL",
    default_model: "llama-3.3-70b-versatile",
  },
};

// Runtime override — set via the /api/llm/provider endpoint (in-memory only)
let _runtimeProvider: string | null = null;

export function setRuntimeProvider(name: string | null): void {
  _runtimeProvider = name ? name.toLowerCase() : null;
}

export function getRuntimeProvider(): string | null {
  return _runtimeProvider;
}

export interface LLMStatus {
  active_provider: string | null;
  active_model: string | null;
  providers: Array<{
    name: string;
    model: string;
    configured: boolean;
  }>;
}

/** Return current provider info and all available providers. */
export function getLLMStatus(): LLMStatus {
  const available = Object.entries(LLM_PROVIDERS).map(([name, cfg]) => {
    const key = process.env[cfg.key_env] ?? "";
    const model = process.env[cfg.model_env] ?? cfg.default_model;
    return { name, model, configured: Boolean(key) };
  });

  let activeName =
    _runtimeProvider || (process.env.LLM_PROVIDER ?? "").toLowerCase();

  if (!activeName) {
    // Auto-detect: first provider with a key set
    for (const [name, cfg] of Object.entries(LLM_PROVIDERS)) {
      if (process.env[cfg.key_env]) {
        activeName = name;
        break;
      }
    }
  }

  const activeCfg = activeName ? LLM_PROVIDERS[activeName] : undefined;
  const activeModel = activeCfg
    ? process.env[activeCfg.model_env] ?? activeCfg.default_model
    : null;

  return {
    active_provider: activeName || null,
    active_model: activeModel,
    providers: available,
  };
}

export interface ResolvedProvider {
  base_url: string;
  api_key: string;
  model: string;
}

/**
 * Resolve which LLM provider to use.
 *
 * Priority: explicit override → runtime provider → LLM_PROVIDER env → auto-detect.
 */
export function resolveProvider(
  overrideProvider?: string | null,
  overrideKey?: string | null
): ResolvedProvider | null {
  // If the caller provides explicit provider + key, use those
  if (overrideProvider && overrideKey) {
    const cfg = LLM_PROVIDERS[overrideProvider.toLowerCase()];
    if (cfg) {
      return {
        base_url: cfg.base_url,
        api_key: overrideKey,
        model: cfg.default_model,
      };
    }
  }

  const providerName =
    _runtimeProvider || (process.env.LLM_PROVIDER ?? "").toLowerCase();

  if (providerName) {
    const cfg = LLM_PROVIDERS[providerName];
    if (cfg) {
      const key = process.env[cfg.key_env] ?? "";
      if (key) {
        return {
          base_url: cfg.base_url,
          api_key: key,
          model: process.env[cfg.model_env] ?? cfg.default_model,
        };
      }
    }
    return null;
  }

  // Auto-detect: first provider whose key is set
  for (const cfg of Object.values(LLM_PROVIDERS)) {
    const key = process.env[cfg.key_env] ?? "";
    if (key) {
      return {
        base_url: cfg.base_url,
        api_key: key,
        model: process.env[cfg.model_env] ?? cfg.default_model,
      };
    }
  }

  return null;
}

/**
 * Call the configured LLM with a chat completion request.
 * Returns the assistant message content, or null on failure.
 */
export async function chatCompletion(
  messages: Array<{ role: string; content: string }>,
  options?: {
    provider?: ResolvedProvider | null;
    maxTokens?: number;
    temperature?: number;
    jsonMode?: boolean;
  }
): Promise<string | null> {
  const provider = options?.provider ?? resolveProvider();
  if (!provider) return null;

  try {
    const body: Record<string, unknown> = {
      model: provider.model,
      messages,
      max_tokens: options?.maxTokens ?? 300,
      temperature: options?.temperature ?? 0.3,
    };
    if (options?.jsonMode) {
      body.response_format = { type: "json_object" };
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    const resp = await fetch(`${provider.base_url}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${provider.api_key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!resp.ok) return null;
    const data = await resp.json();
    return data?.choices?.[0]?.message?.content?.trim() ?? null;
  } catch (err) {
    console.error("LLM Error:", err);
    return null;
  }
}
