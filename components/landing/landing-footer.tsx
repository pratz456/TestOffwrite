import Image from "next/image";
import writeOffLogo from "@/public/writeofflogo.png";
import Link from "next/link";

const LINKS = [
  { label: "How it works", href: "/#how-it-works" },
  { label: "Free tools", href: "/tools" },
  { label: "Blog", href: "/blog" },
  { label: "About", href: "/about" },
  { label: "Help & support", href: "/help" },
  { label: "Privacy & security", href: "/privacy" },
  { label: "Contact", href: "mailto:writeoffapp@gmail.com" },
];

export function LandingFooter() {
  return (
    <footer className="border-t border-slate-200 bg-white">
      <div className="mx-auto max-w-5xl px-4 py-5 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <Link href="/" className="flex min-h-11 items-center gap-2" aria-label="WriteOff home">
            <Image src={writeOffLogo} alt="" width={24} height={24} className="rounded-md" />
            <span className="text-base font-semibold tracking-tight">WriteOff</span>
          </Link>
          <nav className="flex flex-wrap gap-x-4" aria-label="Footer navigation">
            {LINKS.map(link => <Link key={link.href} href={link.href} className="inline-flex min-h-11 items-center text-xs text-slate-600 hover:text-blue-600">{link.label}</Link>)}
          </nav>
        </div>
        <p className="mt-2 text-xs text-slate-500">&copy; {new Date().getFullYear()} WriteOff. All rights reserved.</p>
      </div>
    </footer>
  );
}
