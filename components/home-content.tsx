import { Button } from '@/components/ui/button';
import writeOffLogo from '@/public/writeofflogo.png';
import Image from 'next/image';
import Link from 'next/link';
import { ArrowLeft, CheckCheck, Files, Receipt } from 'lucide-react';

export function HomeContent() {
  return (
    <main className="flex min-h-svh flex-col bg-background px-4 py-5 text-foreground safe-area-inset-top safe-area-inset-bottom sm:px-6">
      <div className="mx-auto flex w-full max-w-md items-center justify-between gap-3">
        <Link href="/" className="inline-flex min-h-11 items-center gap-2" aria-label="WriteOff home">
          <Image src={writeOffLogo} alt="" width={28} height={28} className="rounded-md" />
          <span className="text-lg font-semibold tracking-tight">WriteOff</span>
        </Link>
        <Link href="/" className="inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />Home
        </Link>
      </div>

      <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center py-6">
        <h1 className="text-2xl font-semibold tracking-tight">Welcome to WriteOff</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">Your expenses, receipts, and tax records. Together.</p>

        <div className="mt-5 grid gap-3">
          <Button asChild className="h-12 w-full rounded-xl text-base font-medium"><Link href="/auth/sign-up">Create Account</Link></Button>
          <Button asChild variant="outline" className="h-12 w-full rounded-xl text-base font-medium"><Link href="/auth/login">Sign In</Link></Button>
        </div>

        <ul className="mt-6 space-y-3 border-t border-border pt-5 text-sm text-muted-foreground" aria-label="Your workflow">
          <li className="flex items-center gap-3"><Receipt className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />Add expenses and receipts.</li>
          <li className="flex items-center gap-3"><CheckCheck className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />Review categories and business use.</li>
          <li className="flex items-center gap-3"><Files className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />Keep organized records for tax time.</li>
        </ul>
        <p className="mt-4 text-xs leading-5 text-muted-foreground">You can start without linking a bank. In-app filing is not available.</p>
      </div>

      <footer className="mx-auto w-full max-w-md">
        <nav className="flex flex-wrap items-center justify-center gap-x-5" aria-label="Support and policies">
          <Link href="/help" prefetch={false} className="inline-flex min-h-11 items-center text-xs text-muted-foreground hover:text-foreground">Help & Support</Link>
          <Link href="/privacy" prefetch={false} className="inline-flex min-h-11 items-center text-xs text-muted-foreground hover:text-foreground">Privacy</Link>
          <Link href="/about" prefetch={false} className="inline-flex min-h-11 items-center text-xs text-muted-foreground hover:text-foreground">About</Link>
          <a href="mailto:writeoffapp@gmail.com" className="inline-flex min-h-11 items-center text-xs text-muted-foreground hover:text-foreground">Contact</a>
        </nav>
        <p className="mt-1 text-center text-xs text-muted-foreground">© {new Date().getFullYear()} WriteOff. All rights reserved.</p>
      </footer>
    </main>
  );
}
