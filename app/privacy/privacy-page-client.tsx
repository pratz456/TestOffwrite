"use client";

import React from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Shield, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import writeOffLogo from '@/public/writeofflogo.png';
import Image from 'next/image';
import { CONSENT_TERMS_VERSION } from '@/lib/onboarding/consents';

export default function PrivacyPolicyPageClient() {
  return (
    <div className="min-h-screen bg-background">
      <div className="bg-card border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Image src={writeOffLogo} alt="WriteOff" className="w-8 h-auto" />
              <h1 className="text-2xl font-bold text-foreground">Privacy Policy</h1>
            </div>
            <Link href="/">
              <Button variant="outline" size="sm">
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back to Home
              </Button>
            </Link>
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-6 md:px-8 py-12 md:py-16">
        <Card className="rounded-2xl shadow-tight border border-border dark:bg-card">
          <CardHeader className="p-8 md:p-10 pb-2">
            <CardTitle className="flex items-center gap-2 text-2xl md:text-3xl font-bold tracking-tight mb-1">
              <Shield className="w-5 h-5 text-primary" />
              Privacy Policy
            </CardTitle>
            <CardDescription className="text-sm text-muted-foreground mb-8 font-tabular-nums">
              Effective date: October 11, 2026 (version {CONSENT_TERMS_VERSION})
            </CardDescription>
          </CardHeader>
          <CardContent className="p-8 md:p-10 pt-4 space-y-6 [&>div:not(:first-child)]:mt-10 [&>div:not(:first-child)]:border-t [&>div:not(:first-child)]:border-border [&>div:not(:first-child)]:pt-8 [&_p]:text-base [&_p]:leading-[1.75] [&_p]:text-muted-foreground [&_p]:mb-4 [&_h3]:text-lg md:[&_h3]:text-xl [&_h3]:font-bold [&_h3]:text-foreground [&_h3]:mb-3 [&_ul]:list-disc [&_ul]:list-inside [&_ul]:ml-5 md:[&_ul]:ml-6 [&_ul]:mt-2 [&_ul]:mb-4 [&_ul]:space-y-2 [&_ul]:text-muted-foreground [&_ul]:[&_li]:marker:text-muted-foreground">
            <div>
              <p className="mb-4">
                At WriteOff, we value your privacy and are committed to protecting your personal and financial information. This Privacy Policy explains what information we collect, how we use it, and the choices you have regarding your data.
              </p>
            </div>

            <div>
              <h3>Categories of Data We Collect</h3>
              <ul>
                <li><strong>Account and Profile Information:</strong> name, email address, password credentials handled by Firebase Authentication, state, profession, filing status, business details, and income information</li>
                <li><strong>Financial Records:</strong> bank account metadata and transactions received through Plaid, manual income and expenses, balances, mileage, assets, deductions, quarterly payments, and reconciliation decisions</li>
                <li><strong>Taxpayer and Household Information:</strong> encrypted Social Security numbers, ITINs, EINs, identity-protection PINs, spouse and dependent details, addresses, and tax-organizer answers you choose to provide</li>
                <li><strong>Refund Payment Instructions:</strong> encrypted routing and account numbers you choose to save for tax-organizer records</li>
                <li><strong>Documents and Receipts:</strong> uploaded receipts, W-2s, 1099s, platform summaries, bank or card statements, document images, OCR text, and extracted fields</li>
                <li><strong>User Corrections:</strong> corrections to AI suggestions, kept in your account to personalize future suggestions for you; they are not used to train AI models</li>
                <li><strong>Preferences:</strong> notification settings, user preferences, and customization data</li>
                <li><strong>Support and Operational Data:</strong> support requests, security and access audit records, rate-limit records, webhook replay markers, device or browser information, and operational logs</li>
                <li><strong>Analysis Outputs:</strong> suggested categories, possible tax treatments, explanations, missing-fact prompts, and analysis job status</li>
              </ul>
            </div>

            <div>
              <h3>Purposes of Collection</h3>
              <ul>
                <li>To provide AI-assisted transaction review and supported reports</li>
                <li>To process documents and receipts and extract fields for your review</li>
                <li>To calculate federal planning estimates using the published tax brackets for the selected tax year</li>
                <li>To use your corrections within your account when preparing later suggestions</li>
                <li>To build Schedule C and Form 8829 summaries from your confirmed records</li>
                <li>To provide mobile-responsive experience with PWA functionality</li>
                <li>To import posted bank activity through Plaid when you connect a supported account</li>
                <li>To personalize tax education content that cites IRS publications</li>
                <li>To send configured account, review, and deadline notifications</li>
                <li>To show planning estimates of tax effects based on your selected filing status and tax year</li>
                <li>To manage your account, subscription, support requests, security, and service reliability</li>
                <li>To comply with legal obligations and maintain security standards</li>
              </ul>
            </div>

            <div>
              <h3>Data Retention</h3>
              <p className="mb-3">
                We retain your data as long as your account is active or as needed to provide services, comply with legal obligations, or resolve disputes. You can delete your account at any time from Settings, or ask us to.
              </p>
              <p className="mb-3">
                A successful deletion removes the Firebase Auth user, live profile, owned tax and transaction records, bank tokens, receipts, and active Stripe customer after required provider cleanup succeeds. We retain the account-deletion marker and may retain support-access audits, rate-limit counters, webhook replay markers without a user id, operational logs, and support-mailbox copies according to our operational retention policy. Stripe, Plaid, Google, OpenAI, and other providers may retain records under their own legal and operational obligations.
              </p>
              <p className="mb-3">
                Deleted records can remain recoverable in point-in-time recovery for up to 7 days, scheduled backups for up to 14 weeks, and Google infrastructure backups for up to about six months before expiry. Cloud Logging entries can remain for about 30 days and required Google audit logs can remain longer. Backups are used for service recovery; deletion markers are used to reapply deletion after a restore.
              </p>
            </div>

            <div>
              <h3>Third Parties</h3>
              <ul>
                <li>Plaid (for bank data aggregation; you connect your bank inside Plaid and we never receive your bank login)</li>
                <li>Google Firebase and Google Cloud (for authentication, database, file storage, and hosting)</li>
                <li>OpenAI (for AI analysis of your transactions and of tax documents, bank statements, or receipts you choose to upload for extraction; a W-2, 1099 or platform summary is first read on our own server and sent as text with Social Security, ITIN and employer identification numbers removed, and its full image is sent only with your signed consent; prompts are sent with storage disabled and are not used to train OpenAI models)</li>
                <li>Stripe (for subscription payments; your card details are entered on Stripe&apos;s payment page and never reach our servers)</li>
                <li>Resend (for delivering account, support, and product email)</li>
                <li>Google Analytics (only when enabled for a release, for site usage measurement)</li>
                <li>Receipt text recognition for individual receipts runs on our own servers and is not sent to a third party</li>
              </ul>
            </div>

            <div>
              <h3>Security Measures</h3>
              <ul>
                <li>Encryption in transit and at rest, and read-only bank connections</li>
                <li>Owner-scoped access controls enforced by database security rules, automated security tests on every release, and a written information security program</li>
                <li>Vendor access and processing limited to the services described in this policy and our subprocessor records</li>
                <li>Secure processing of receipt images and OCR data</li>
                <li>Your corrections stay within your account and are not used to train AI models</li>
              </ul>
              <p className="mt-3">
                While no system is 100% secure, we continuously work to safeguard your data.
                Processing follows our written information security program, which we review at least annually.
              </p>
            </div>

            <div>
              <h3>GLBA Privacy Rule</h3>
              <p className="mb-3">
                We do not sell nonpublic personal information. We disclose information to the service providers listed above and when otherwise permitted or required by law to operate and protect the service.
              </p>
            </div>

            <div>
              <h3>Data Processing & Compliance</h3>
              <p className="mb-3">
                We use Google Firebase, which provides data processing and compliance in accordance with applicable laws. See <a href="https://firebase.google.com/support/privacy" className="text-primary font-medium no-underline hover:underline transition-colors duration-150 hover:underline-offset-2" target="_blank" rel="noopener noreferrer">Firebase Privacy & Compliance</a>.
              </p>
            </div>

            <div>
              <h3>Your Rights</h3>
              <ul>
                <li>View and export your data</li>
                <li>Request deletion of your account and data</li>
                <li>Revoke access to your bank data via Plaid</li>
              </ul>
              <p className="mt-3">
                To exercise these rights, visit the Data Rights section in your account settings or contact us at <a href="mailto:writeoffapp@gmail.com" className="text-primary font-medium no-underline hover:underline transition-colors duration-150 hover:underline-offset-2">writeoffapp@gmail.com</a>.
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
