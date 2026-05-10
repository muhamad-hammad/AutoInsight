"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

export default function Nav() {
  const [dark, setDark] = useState(true);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const id   = searchParams.get("id");
  const name = searchParams.get("name");

  useEffect(() => {
    try {
      const saved = localStorage.getItem("ai-theme");
      setDark(!saved || saved === "dark");
    } catch {}
  }, []);

  const toggle = () => {
    document.documentElement.classList.add("theme-transitioning");
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try { localStorage.setItem("ai-theme", next ? "dark" : "light"); } catch {}
    setTimeout(() => document.documentElement.classList.remove("theme-transitioning"), 300);
  };

  const onWorkspace = pathname === "/workspace";
  const onAdvisor   = pathname === "/advisor";
  const showCrumb   = onWorkspace || onAdvisor;

  const workspaceHref = id && name
    ? `/workspace?id=${id}&name=${name}`
    : "/workspace";

  return (
    <nav className="h-[52px] sticky top-0 z-50 flex items-center px-6 gap-0
                    border-b border-border"
         style={{ background: "var(--bg-nav)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)" }}>
      {/* Logo */}
      <Link href="/" className="flex items-center gap-2 mr-8 no-underline flex-none">
        <div className="w-[26px] h-[26px] rounded-[6px] flex items-center justify-center flex-none"
             style={{ background: "var(--accent)" }}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <rect x="1" y="7" width="3" height="6" rx="1" fill="white" opacity="0.7"/>
            <rect x="5.5" y="4" width="3" height="9" rx="1" fill="white" opacity="0.85"/>
            <rect x="10" y="1" width="3" height="12" rx="1" fill="white"/>
          </svg>
        </div>
        <span className="font-dm-sans font-semibold text-[15px] text-text-primary tracking-tight">
          AutoInsight
        </span>
      </Link>

      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 flex-1">
        {showCrumb && (
          <>
            <Link href="/"
              className="font-dm-mono text-[13px] text-text-muted no-underline hover:text-text-primary transition-colors">
              upload
            </Link>
            <span className="font-dm-mono text-[13px] text-text-faint">/</span>
            <Link href={workspaceHref}
              className={[
                "font-dm-mono text-[13px] no-underline transition-colors",
                onWorkspace
                  ? "text-text-primary font-semibold"
                  : "text-text-muted hover:text-text-primary",
              ].join(" ")}>
              workspace
            </Link>
            {onAdvisor && (
              <>
                <span className="font-dm-mono text-[13px] text-text-faint">/</span>
                <span className="font-dm-mono text-[13px] text-text-primary font-semibold">
                  advisor
                </span>
              </>
            )}
          </>
        )}
      </div>

      {/* Right controls */}
      <div className="flex items-center gap-2">
        {onWorkspace && id && (
          <Link
            href={`/advisor?id=${id}&name=${name ?? ""}&target=`}
            className="flex items-center gap-1.5 bg-accent text-white no-underline
                       rounded-[7px] px-3.5 py-1.5 font-dm-sans font-semibold text-[12px]
                       hover:opacity-90 transition-opacity"
          >
            Model Advisor
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M2 5h6M5.5 2.5L8 5l-2.5 2.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </Link>
        )}
        <button
          onClick={() => window.dispatchEvent(new CustomEvent("open-llm-settings"))}
          title="LLM Settings"
          className="w-[34px] h-[34px] rounded-lg flex items-center justify-center
                     text-text-muted hover:text-text-primary
                     border border-border bg-surface-raised
                     transition-all duration-120 cursor-pointer"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" 
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
            <circle cx="12" cy="12" r="3"/>
          </svg>
        </button>
        <ThemeToggle dark={dark} onToggle={toggle} />
      </div>
    </nav>
  );
}

function ThemeToggle({ dark, onToggle }: { dark: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      title={dark ? "Switch to light mode" : "Switch to dark mode"}
      type="button"
      className="w-[34px] h-[34px] rounded-lg flex items-center justify-center
                 text-text-muted hover:text-text-primary
                 border border-border bg-surface-raised
                 transition-all duration-120 cursor-pointer"
    >
      {dark ? (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="4"/>
          <line x1="12" y1="2"  x2="12" y2="4"/>
          <line x1="12" y1="20" x2="12" y2="22"/>
          <line x1="4.22"  y1="4.22"  x2="5.64"  y2="5.64"/>
          <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
          <line x1="2"  y1="12" x2="4"  y2="12"/>
          <line x1="20" y1="12" x2="22" y2="12"/>
          <line x1="4.22"  y1="19.78" x2="5.64"  y2="18.36"/>
          <line x1="18.36" y1="5.64"  x2="19.78" y2="4.22"/>
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none"
          stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
          <path d="M11.5 8.5A5 5 0 115.5 2.5a3.5 3.5 0 006 6z"/>
        </svg>
      )}
    </button>
  );
}
