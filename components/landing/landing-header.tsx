"use client";

import Image from "next/image";
import writeOffLogo from "@/public/writeofflogo.png";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Menu, X } from "lucide-react";
import { CtaButton } from "./cta-button";

const NAV_LINKS = [
  { label: "How it works", href: "/#how-it-works" },
  { label: "Plans & questions", href: "/#availability" },
  { label: "Free tools", href: "/tools" },
];

export function LandingHeader() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!mobileOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMobileOpen(false);
      menuButton.current?.focus();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [mobileOpen]);

  return (
    <header className="sticky top-0 z-50 border-b border-slate-200/80 bg-[#f5f5f7]/95 backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-2 px-4 sm:px-6">
        <Link href="/" className="flex min-h-11 shrink-0 items-center gap-2 no-tap-highlight" aria-label="WriteOff home">
          <Image src={writeOffLogo} alt="" width={28} height={28} className="rounded-md" />
          <span className="text-lg font-semibold tracking-tight">WriteOff</span>
        </Link>
        <nav className="hidden items-center gap-1 md:flex" aria-label="Main navigation">
          {NAV_LINKS.map((link) => (
            <a key={link.href} href={link.href} className="inline-flex min-h-11 items-center rounded-md px-3 text-sm text-slate-600 hover:text-blue-600">{link.label}</a>
          ))}
        </nav>
        <div className="flex items-center gap-1">
          <CtaButton label="Get started" />
          <button ref={menuButton} type="button" className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 md:hidden no-tap-highlight" onClick={() => setMobileOpen(!mobileOpen)} aria-label={mobileOpen ? "Close navigation" : "Open navigation"} aria-expanded={mobileOpen} aria-controls="landing-mobile-navigation">
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>
      {mobileOpen && (
        <nav id="landing-mobile-navigation" className="border-t border-slate-200 bg-white px-4 py-2 md:hidden" aria-label="Mobile navigation">
          {NAV_LINKS.map((link) => (
            <a key={link.href} href={link.href} onClick={() => setMobileOpen(false)} className="flex min-h-11 items-center rounded-lg px-3 text-sm text-slate-600 hover:bg-slate-50 hover:text-blue-600">{link.label}</a>
          ))}
          <Link href="/auth/login" onClick={() => setMobileOpen(false)} className="flex min-h-11 items-center rounded-lg px-3 text-sm font-medium text-blue-600">Sign in</Link>
        </nav>
      )}
    </header>
  );
}
