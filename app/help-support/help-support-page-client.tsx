"use client";

import React from 'react';
import { Button } from '@/components/ui/button';
import { ArrowLeft, ArrowRight, BookOpen, CreditCard, FileText, HelpCircle, MessageCircle } from 'lucide-react';
import Link from 'next/link';
import writeOffLogo from '@/public/writeofflogo.png';
import Image from 'next/image';

const resources = [
  { title: 'Getting started', detail: 'Open your workspace to add records and review your next steps.', href: '/protected', action: 'Open WriteOff', icon: BookOpen },
  { title: 'Bank connections', detail: 'Connect an account or review an existing connection in your workspace.', href: '/protected?screen=banks-detail', action: 'Manage connections', icon: CreditCard },
  { title: 'Reports & analytics', detail: 'Review your saved records and supported planning reports.', href: '/protected/reports', action: 'Open reports', icon: FileText },
  { title: 'Frequently asked questions', detail: 'Find answers about accounts, records and using WriteOff.', href: '/help?tab=faq', action: 'Read FAQ', icon: HelpCircle },
];

export default function HelpSupportPageClient() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <Image src={writeOffLogo} alt="WriteOff" className="h-8 w-auto" />
            <h1 className="text-xl font-semibold tracking-tight text-foreground">Help &amp; Support</h1>
          </div>
          <Button variant="outline" size="sm" className="min-h-11" asChild><Link href="/"><ArrowLeft className="mr-2 h-4 w-4" />Back to Home</Link></Button>
        </div>
      </header>
      <main className="mx-auto max-w-6xl space-y-4 px-4 py-6 sm:px-6 lg:px-8">
        <section className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-card p-4 sm:p-5">
          <div className="min-w-0">
            <h2 className="text-xl font-semibold tracking-tight text-foreground">How can we help?</h2>
            <p className="mt-1 text-sm text-muted-foreground">Choose a topic or send our support team a message.</p>
          </div>
          <Button className="min-h-11" asChild><Link href="/contact"><MessageCircle className="mr-2 h-4 w-4" />Contact support</Link></Button>
        </section>
        <div className="grid gap-3 sm:grid-cols-2">
          {resources.map(({ title, detail, href, action, icon: Icon }) => (
            <section key={href} className="rounded-xl border border-border bg-card p-4">
              <h2 className="flex items-center gap-2 text-base font-semibold"><Icon className="h-4 w-4 text-primary" aria-hidden="true" />{title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{detail}</p>
              <Link href={href} className="mt-2 inline-flex min-h-11 items-center gap-2 rounded-md text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{action}<ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
            </section>
          ))}
        </div>
        <p className="text-sm text-muted-foreground">Prefer email? <a href="mailto:writeoffapp@gmail.com?subject=WriteOff%20Support%20Request" className="inline-flex min-h-11 items-center rounded-md font-medium text-primary hover:underline">writeoffapp@gmail.com</a></p>
      </main>
    </div>
  );
}
