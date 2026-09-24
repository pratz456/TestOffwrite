"use client";

import React from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import Link from 'next/link';
import { CONSENT_TERMS_VERSION } from '@/lib/onboarding/consents';

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-full bg-background">
      <header className="border-b border-border bg-background">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight text-foreground">Privacy Policy</h1>
          </div>
          <Button asChild variant="outline" size="sm" className="shrink-0">
            <Link href="/protected" aria-label="Back to dashboard">Back</Link>
          </Button>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-4">
        <Card className="rounded-xl border-border shadow-none">
          <CardHeader className="p-4 pb-3">
            <CardDescription className="text-xs text-muted-foreground font-tabular-nums">
              Effective date: September 18, 2026 (version {CONSENT_TERMS_VERSION})
            </CardDescription>
          </CardHeader>
          <CardContent className="p-4 pt-0 space-y-4 [&>div:not(:first-child)]:border-t [&>div:not(:first-child)]:border-border [&>div:not(:first-child)]:pt-4 [&_p]:text-sm [&_p]:leading-6 [&_p]:text-muted-foreground [&_p]:mb-2 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-foreground [&_h3]:mb-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:mt-2 [&_ul]:mb-2 [&_ul]:space-y-1 [&_ul]:text-sm [&_ul]:leading-6 [&_ul]:text-muted-foreground">
            <div>
              <p className="mb-4">
                At WriteOff ("we," "our," or "us"), we value your privacy and are committed to protecting your personal and financial information. This Privacy Policy explains what information we collect, how we use it, and the choices you have regarding your data.
              </p>
            </div>

            <div>
              <h3>Information We Collect</h3>
              <p className="mb-3">
                We may collect the following types of information:
              </p>
              <ul>
                <li><strong>Personal Information:</strong> such as your name, email address, state, profession, filing status, and income.</li>
                <li><strong>Financial Information:</strong> securely obtained through bank connections (via trusted partners like Plaid).</li>
                <li><strong>Transaction Data:</strong> including purchase history, expenses, and uploaded receipts.</li>
                <li><strong>Usage Data:</strong> such as device information, app interactions, and preferences.</li>
              </ul>
            </div>

            <div>
              <h3>How We Use Your Information</h3>
              <p className="mb-3">
                We use your information to:
              </p>
              <ul>
                <li>Provide, maintain, and improve our services.</li>
                <li>Process transactions and analyze expenses.</li>
                <li>Generate tax reports, insights, and personalized analytics.</li>
                <li>Communicate with you about product updates, features, and support.</li>
                <li>Ensure security, detect fraud, and comply with legal obligations.</li>
              </ul>
            </div>

            <div>
              <h3>How We Share Information</h3>
              <p className="mb-3">
                We do not sell or rent your personal information. We may share information only with:
              </p>
              <ul>
                <li><strong>Service Providers</strong> (Plaid for bank connections, Google Firebase and Google Cloud for hosting and storage, OpenAI for AI analysis with storage disabled, Stripe for payments, Resend for support email) to operate our services.</li>
                <li><strong>Legal Authorities</strong> if required by law, regulation, or to protect rights and safety.</li>
              </ul>
            </div>

            <div>
              <h3>Data Security</h3>
              <p className="mb-3">
                We take the protection of your data seriously. Measures include:
              </p>
              <ul>
                <li>Encryption in transit and at rest, and read-only bank connections.</li>
                <li>Owner-scoped access controls enforced by database security rules, automated security tests on every release, and a written information security program.</li>
                <li>Partnerships with audited and compliant service providers.</li>
              </ul>
              <p className="mt-3">
                While no system is 100% secure, we continuously work to safeguard your data.
              </p>
            </div>

            <div>
              <h3>Your Rights</h3>
              <p className="mb-3">
                You have the right to:
              </p>
              <ul>
                <li>Access, update, or correct your personal information.</li>
                <li>Request deletion of your data.</li>
                <li>Disconnect your bank accounts at any time.</li>
                <li>Opt-out of marketing communications.</li>
              </ul>
              <p className="mt-3">
                To exercise these rights, contact us at <a href="mailto:writeoffapp@gmail.com" className="text-primary font-medium no-underline hover:underline transition-colors duration-150 hover:underline-offset-2">writeoffapp@gmail.com</a>.
              </p>
            </div>

            <div>
              <h3>Children's Privacy</h3>
              <p>
                Our services are not directed to individuals under 13, and we do not knowingly collect data from children.
              </p>
            </div>

            <div>
              <h3>Changes to This Policy</h3>
              <p>
                We may update this Privacy Policy from time to time. If significant changes are made, we will notify you by updating the "Last Updated" date and, when appropriate, through direct communication.
              </p>
            </div>

            <div>
              <h3>Contact Us</h3>
              <p>
                For questions or concerns about this Privacy Policy or our data practices, please email us at <a href="mailto:writeoffapp@gmail.com" className="text-primary font-medium no-underline hover:underline transition-colors duration-150 hover:underline-offset-2">writeoffapp@gmail.com</a>.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
