"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";

const PROVIDERS = [
  { id: "openai", name: "OpenAI (GPT-4o mini)" },
  { id: "openrouter", name: "OpenRouter (Llama 3.3)" },
  { id: "gemini", name: "Google Gemini (2.0 Flash)" },
  { id: "grok", name: "xAI Grok (3 mini)" },
  { id: "groq", name: "Groq (Llama 3.3)" },
];

export default function LLMConfigModal({ forceShow = false, onClose }: { forceShow?: boolean; onClose?: () => void }) {
  const [isOpen, setIsOpen] = useState(false);
  const [provider, setProvider] = useState("openai");
  const [key, setKey] = useState("");

  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const savedProvider = localStorage.getItem("ai-llm-provider");
    const savedKey = localStorage.getItem("ai-llm-key");
    
    if (savedProvider) setProvider(savedProvider);
    if (savedKey) setKey(savedKey);

    if (forceShow || !savedKey) {
      setIsOpen(true);
    }

    const handleOpen = () => setIsOpen(true);
    window.addEventListener("open-llm-settings", handleOpen);
    return () => window.removeEventListener("open-llm-settings", handleOpen);
  }, [forceShow]);

  const handleSave = () => {
    localStorage.setItem("ai-llm-provider", provider);
    localStorage.setItem("ai-llm-key", key);
    setIsOpen(false);
    if (onClose) onClose();
  };

  if (!isOpen || !mounted) return null;

  const modalContent = (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto animate-in fade-in duration-200">
      <div 
        className="w-full max-w-[440px] bg-surface-raised border border-border rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 my-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-5 border-b border-border bg-surface/50">
          <h2 className="text-[18px] font-dm-sans font-bold text-text-primary tracking-tight">
            Configure LLM Provider
          </h2>
          <p className="text-[13px] text-text-muted mt-1 leading-relaxed">
            AutoInsight uses an LLM to generate intelligent model recommendations and code snippets.
          </p>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5">
          <div className="space-y-2">
            <label className="text-[12px] font-dm-mono font-medium text-text-muted uppercase tracking-wider">
              Provider
            </label>
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              className="w-full bg-surface border border-border rounded-lg px-4 py-2.5 text-[14px] text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent transition-all cursor-pointer"
            >
              {PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-[12px] font-dm-mono font-medium text-text-muted uppercase tracking-wider">
              API Key
            </label>
            <div className="relative">
              <input
                type="password"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="Enter your API key..."
                className="w-full bg-surface border border-border rounded-lg px-4 py-2.5 text-[14px] text-text-primary placeholder:text-text-faint focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent transition-all"
              />
              <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-text-faint">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3y-3.5L15.5 7.5z" />
                </svg>
              </div>
            </div>
            <p className="text-[11px] text-text-faint italic">
              Your key is saved locally in your browser cache and never stored on our servers.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-surface/30 border-t border-border flex justify-end gap-3">
          {!forceShow && key && (
            <button
              onClick={() => setIsOpen(false)}
              className="px-4 py-2 text-[13px] font-dm-sans font-semibold text-text-muted hover:text-text-primary transition-colors cursor-pointer"
            >
              Cancel
            </button>
          )}
          <button
            onClick={handleSave}
            disabled={!key}
            className="px-6 py-2 bg-accent text-white rounded-lg text-[13px] font-dm-sans font-bold hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-accent/20"
          >
            Save Configuration
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}

