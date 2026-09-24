"use client";

import React, { useState, useEffect, Suspense } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ArrowRight, HelpCircle, Shield, Info, MessageCircle, BookOpen, CreditCard, FileText, Camera, Calculator, Sparkles } from 'lucide-react';
import Link from 'next/link';
import writeOffLogo from '@/public/writeofflogo.png';
import Image from 'next/image';
import { useSearchParams } from 'next/navigation';
import { FAQSection } from '@/components/faq-section';
import { ContactSupportForm } from '@/components/contact-support-form';

const workspaceLinks = [
  { title: 'Getting started', description: 'Add records and review the next steps in your workspace.', href: '/protected', action: 'Open WriteOff', icon: BookOpen },
  { title: 'Bank connections', description: 'Connect an account or check an existing connection.', href: '/protected?screen=banks-detail', action: 'Manage connections', icon: CreditCard },
  { title: 'Receipt scanning', description: 'Upload a receipt and check its extracted details before saving.', href: '/protected?screen=receipt-upload', action: 'Upload a receipt', icon: Camera },
  { title: 'Quarterly planning', description: 'Review estimated-payment methods using your recorded facts.', href: '/protected?screen=quarterly-taxes', action: 'Open payment planning', icon: Calculator },
  { title: 'AI transaction review', description: 'Confirm or correct suggestions and add missing business details.', href: '/protected?screen=review-transactions', action: 'Review transactions', icon: Sparkles },
  { title: 'Reports & exports', description: 'Review supported tax summaries and download records for your preparer.', href: '/protected?screen=tax-filing-hub', action: 'Open filing & exports', icon: FileText },
];

function HelpPageContent() {
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState('help');

  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab && ['help', 'privacy', 'about', 'faq', 'contact'].includes(tab)) setActiveTab(tab);
  }, [searchParams]);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <Image src={writeOffLogo} alt="WriteOff" className="h-8 w-auto" />
            <h1 className="text-xl font-semibold tracking-tight text-foreground">Help &amp; Support</h1>
          </div>
          <Button variant="outline" size="sm" className="min-h-11" asChild><Link href="/">Back to Home</Link></Button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-5 sm:px-6 lg:px-8">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <TabsList aria-label="Help sections" className="grid h-auto w-full grid-cols-5 gap-1 p-1">
            {[
              { value: 'help', label: 'Help', icon: HelpCircle },
              { value: 'faq', label: 'FAQ', icon: HelpCircle },
              { value: 'contact', label: 'Contact', icon: MessageCircle },
              { value: 'privacy', label: 'Privacy', icon: Shield },
              { value: 'about', label: 'About', icon: Info },
            ].map(({ value, label, icon: Icon }) => <TabsTrigger key={value} value={value} className="min-h-11 min-w-0 gap-1.5 px-1 text-xs sm:px-3 sm:text-sm"><Icon className="hidden h-4 w-4 sm:block" aria-hidden="true" />{label}</TabsTrigger>)}
          </TabsList>

          <TabsContent value="help" className="space-y-4">
            <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4">
              <div><h2 className="text-lg font-semibold">Find what you need</h2><p className="mt-1 text-sm text-muted-foreground">Open a feature, browse FAQs, or ask us about your account.</p></div>
              <Button className="min-h-11" onClick={() => setActiveTab('contact')}><MessageCircle className="mr-2 h-4 w-4" />Contact support</Button>
            </section>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {workspaceLinks.map(({ title, description, href, action, icon: Icon }) => (
                <section key={href} className="rounded-xl border border-border bg-card p-4">
                  <h2 className="flex items-center gap-2 text-base font-semibold"><Icon className="h-4 w-4 text-primary" aria-hidden="true" />{title}</h2>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{description}</p>
                  <Link href={href} className="mt-2 inline-flex min-h-11 items-center gap-1.5 rounded-md text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{action}<ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
                </section>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="faq" className="mx-auto max-w-4xl"><FAQSection /></TabsContent>
          <TabsContent value="contact" className="mx-auto max-w-4xl"><ContactSupportForm /></TabsContent>

          <TabsContent value="privacy" className="mx-auto max-w-3xl">
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2 text-lg"><Shield className="h-5 w-5 text-primary" />Privacy Policy</CardTitle><CardDescription>Read how WriteOff handles information and the choices available to you.</CardDescription></CardHeader>
              <CardContent><Button className="min-h-11" asChild><Link href="/privacy">Read the current Privacy Policy<ArrowRight className="ml-2 h-4 w-4" /></Link></Button></CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="about" className="mx-auto max-w-3xl">
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2 text-lg"><Info className="h-5 w-5 text-primary" />About WriteOff</CardTitle><CardDescription>Business records, reviewable AI suggestions, and tax planning tools for self-employed people.</CardDescription></CardHeader>
              <CardContent className="space-y-3"><p className="text-sm leading-relaxed text-muted-foreground">Learn what WriteOff supports and how it helps you organize records for your tax preparer.</p><Button className="min-h-11" asChild><Link href="/about">About WriteOff<ArrowRight className="ml-2 h-4 w-4" /></Link></Button></CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

export default function HelpPageClient() {
  return <Suspense fallback={<div role="status" className="mx-auto max-w-6xl px-4 py-6 text-sm text-muted-foreground">Loading help…</div>}><HelpPageContent /></Suspense>;
}
