import type { Metadata } from "next";
import { Suspense } from "react";
import "./globals.css";
import Nav from "@/components/Nav";
import LLMConfigModal from "@/components/LLMConfigModal";

export const metadata: Metadata = {
  title: "Auto-Insight — Automated ML Platform",
  description: "Upload a dataset to profile it and get model recommendations.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=DM+Mono:ital,wght@0,300;0,400;0,500;1,400&family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&family=Fira+Code:wght@400;500&display=swap"
          rel="stylesheet"
        />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('ai-theme');if(!t||t==='dark')document.documentElement.classList.add('dark')}catch(e){document.documentElement.classList.add('dark')}})();`,
          }}
        />
      </head>
      <body className="min-h-screen overflow-y-auto">
        <Suspense fallback={<div className="h-[52px] border-b border-border bg-surface" />}>
          <Nav />
        </Suspense>
        {children}
        <LLMConfigModal />
      </body>
    </html>
  );
}
