import Image from "next/image";
import Link from "next/link";
import { AuthButtons } from "./cta-button";

export function LandingFooter() {
  return (
    <footer className="relative border-t border-border overflow-hidden">
      <div className="absolute inset-0 -z-10 bg-gradient-to-b from-card via-card to-background" />
      <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 lg:px-8">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          <div className="lg:col-span-1">
            <Link href="/" className="flex items-center gap-2.5">
              <Image src="/writeofflogo.png" alt="WriteOff" width={28} height={28} className="rounded-md" />
              <span className="text-lg font-bold text-foreground">WriteOff</span>
            </Link>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">The AI-powered tax assistant that works year-round to help freelancers and gig workers save money.</p>
          </div>
          <div>
            <h4 className="text-sm font-semibold text-foreground">Product</h4>
            <ul className="mt-4 space-y-2.5 text-sm text-muted-foreground">
              <li><a href="#features" className="transition-colors hover:text-primary">Features</a></li>
              <li><Link href="/privacy" className="transition-colors hover:text-primary">Security</Link></li>
            </ul>
          </div>
          <div>
            <h4 className="text-sm font-semibold text-foreground">Company</h4>
            <ul className="mt-4 space-y-2.5 text-sm text-muted-foreground">
              <li><Link href="/about" className="transition-colors hover:text-primary">About</Link></li>
              <li><Link href="/help" className="transition-colors hover:text-primary">Help & Support</Link></li>
              <li><Link href="/privacy" className="transition-colors hover:text-primary">Privacy Policy</Link></li>
            </ul>
          </div>
          <div>
            <h4 className="text-sm font-semibold text-foreground">Get Started</h4>
            <p className="mt-4 text-sm text-muted-foreground">Ready to stop overpaying taxes? Start your free 30-day trial &mdash; no credit card required.</p>
            <div className="mt-4"><AuthButtons size="default" /></div>
          </div>
        </div>
        <div className="mt-12 flex flex-col items-center gap-2 border-t border-border pt-6 text-center text-xs text-muted-foreground sm:flex-row sm:justify-between">
          <p>&copy; {new Date().getFullYear()} WriteOff. All rights reserved.</p>
          <div className="flex gap-4">
            <Link href="/privacy" className="hover:text-primary transition-colors">Privacy</Link>
            <Link href="/about" className="hover:text-primary transition-colors">About</Link>
            <a href="mailto:writeoffapp@gmail.com" className="hover:text-primary transition-colors">Contact</a>
          </div>
        </div>
      </div>
    </footer>
  );
}
