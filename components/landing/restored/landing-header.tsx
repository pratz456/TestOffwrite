"use client";

import Image from "next/image";
import writeOffLogo from "@/public/writeofflogo.png";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Menu, X } from "lucide-react";
import { AuthButtons } from "./cta-button";

const NAV_LINKS = [
  { label: "Home", href: "/" },
  { label: "Problem", href: "/#problem" },
  { label: "Features", href: "/#features" },
  { label: "How It Works", href: "/#how-it-works" },
  { label: "Availability", href: "/#availability" },
  { label: "Blog", href: "/blog" },
  { label: "Tools", href: "/tools" },
];

export function LandingHeader() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!mobileOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setMobileOpen(false); menuButton.current?.focus(); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mobileOpen]);

  return (
    <header className="sticky top-0 z-50 w-full bg-background/80 backdrop-blur-xl">
      <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-primary/30 to-transparent" />
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link href="/" className="flex min-h-11 shrink-0 items-center gap-2.5 no-tap-highlight" aria-label="WriteOff home">
          <Image src={writeOffLogo} alt="" width={32} height={32} className="rounded-md" />
          <span className="text-lg font-bold tracking-tight text-foreground">WriteOff</span>
        </Link>
        <nav className="hidden items-center gap-1 xl:flex" aria-label="Main navigation">
          {NAV_LINKS.map((l) => (
            <a key={l.label} href={l.href} className="rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">{l.label}</a>
          ))}
        </nav>
        <div className="hidden xl:block"><AuthButtons size="default" /></div>
        <button ref={menuButton} type="button" className="inline-flex h-11 w-11 items-center justify-center rounded-md p-2 text-muted-foreground hover:text-foreground xl:hidden no-tap-highlight" onClick={() => setMobileOpen(!mobileOpen)} aria-label={mobileOpen ? "Close navigation" : "Open navigation"} aria-expanded={mobileOpen} aria-controls="homepage-mobile-navigation">
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>
      {mobileOpen && (
        <div id="homepage-mobile-navigation" className="border-t border-border/40 bg-background px-4 pb-4 pt-2 xl:hidden">
          <nav className="flex flex-col gap-1" aria-label="Mobile navigation">
            {NAV_LINKS.map((l) => (
              <a key={l.label} href={l.href} onClick={() => setMobileOpen(false)} className="flex min-h-11 items-center rounded-md px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">{l.label}</a>
            ))}
          </nav>
          <div className="mt-3"><AuthButtons size="default" className="w-full flex-col" /></div>
        </div>
      )}
    </header>
  );
}
