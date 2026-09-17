"use client";

import React from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Shield, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import writeOffLogo from '@/public/writeofflogo.png';
import Image from 'next/image';

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
              Effective date: September 17, 2026 (version 2026-09-17)
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
                <li><strong>Personal Information:</strong> name, email address, state, profession, filing status, income</li>
                <li><strong>Financial Data:</strong> bank account and transaction data via Plaid integration</li>
                <li><strong>Receipt Data:</strong> receipt images and OCR-extracted transaction details</li>
                <li><strong>User Corrections:</strong> corrections to AI suggestions, kept in your account to personalize future suggestions for you; they are not used to train AI models</li>
                <li><strong>Tax Data:</strong> quarterly tax calculation data, payment tracking, and tax bracket information</li>
                <li><strong>Mobile Data:</strong> device information for PWA functionality and mobile optimization</li>
                <li><strong>Preferences:</strong> notification settings, user preferences, and customization data</li>
                <li><strong>Voice Data:</strong> if you use voice entry, your browser&apos;s speech recognition converts your speech to text and the text is sent to our AI provider to identify the expense; we do not store audio</li>
                <li><strong>Usage Analytics:</strong> app usage patterns, feature interactions, and performance data</li>
                <li><strong>Inferences:</strong> tax deduction analysis, personalized insights, and optimization recommendations</li>
              </ul>
            </div>

            <div>
              <h3>Purposes of Collection</h3>
              <ul>
                <li>To provide AI-powered tax deduction analysis and generate comprehensive reports</li>
                <li>To automatically process receipts and extract transaction details using OCR</li>
                <li>To calculate federal planning estimates using the published tax brackets for the selected tax year</li>
                <li>To provide personalized AI insights and tax optimization recommendations</li>
                <li>To learn from your corrections and improve AI accuracy over time</li>
                <li>To build Schedule C and Form 8829 summaries from your confirmed records</li>
                <li>To process voice input for hands-free expense tracking</li>
                <li>To provide mobile-responsive experience with PWA functionality</li>
                <li>To integrate with bank accounts via Plaid for automatic transaction import</li>
                <li>To personalize tax education content that cites IRS publications</li>
                <li>To send smart notifications for quarterly tax deadlines and important updates</li>
                <li>To show planning estimates of tax effects based on your selected filing status and tax year</li>
                <li>To manage your account and provide comprehensive customer support</li>
                <li>To improve our services, user experience, and AI capabilities</li>
                <li>To comply with legal obligations and maintain security standards</li>
              </ul>
            </div>

            <div>
              <h3>Data Retention</h3>
              <p className="mb-3">
                We retain your data as long as your account is active or as needed to provide services, comply with legal obligations, or resolve disputes. You may request deletion at any time.
              </p>
            </div>

            <div>
              <h3>Third Parties</h3>
              <ul>
                <li>Plaid (for bank data aggregation; you connect your bank inside Plaid and we never receive your bank login)</li>
                <li>Google Firebase and Google Cloud (for authentication, database, file storage, and hosting)</li>
                <li>OpenAI (for AI analysis of your transactions and of tax documents, bank statements, or receipts you choose to upload for extraction; prompts are sent with storage disabled and are not used to train OpenAI models)</li>
                <li>Stripe (for subscription payments; your card details are entered on Stripe&apos;s payment page and never reach our servers)</li>
                <li>Resend (for delivering email when you send a question to a tax professional through the app)</li>
                <li>Google Analytics (only when enabled for a release, for site usage measurement)</li>
                <li>Receipt text recognition for individual receipts runs on our own servers and is not sent to a third party</li>
              </ul>
            </div>

            <div>
              <h3>Security Measures</h3>
              <ul>
                <li>Encryption in transit and at rest, and read-only bank connections</li>
                <li>Owner-scoped access controls enforced by database security rules, automated security tests on every release, and a written information security program</li>
                <li>Partnerships with audited and compliant service providers</li>
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
                We do not share your nonpublic personal information with non-affiliated third parties except as permitted by law. You have the right to opt out of any such sharing, but we do not engage in it.
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
