"use client";

import React from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Shield, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import writeOffLogo from '@/public/writeofflogo.png';
import Image from 'next/image';

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="bg-card border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Image src={writeOffLogo} alt="WriteOff" className="w-8 h-auto" />
              <h1 className="text-2xl font-bold text-foreground">Privacy Policy</h1>
            </div>
            <Link href="/protected">
              <Button variant="outline" size="sm">
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back to Dashboard
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
              Last updated: {new Date().toLocaleDateString()}
            </CardDescription>
          </CardHeader>
          <CardContent className="p-8 md:p-10 pt-4 space-y-6 [&>div:not(:first-child)]:mt-10 [&>div:not(:first-child)]:border-t [&>div:not(:first-child)]:border-border [&>div:not(:first-child)]:pt-8 [&_p]:text-base [&_p]:leading-[1.75] [&_p]:text-muted-foreground [&_p]:mb-4 [&_h3]:text-lg md:[&_h3]:text-xl [&_h3]:font-bold [&_h3]:text-foreground [&_h3]:mb-3 [&_ul]:list-disc [&_ul]:list-inside [&_ul]:ml-5 md:[&_ul]:ml-6 [&_ul]:mt-2 [&_ul]:mb-4 [&_ul]:space-y-2 [&_ul]:text-muted-foreground [&_ul]:[&_li]:marker:text-muted-foreground">
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
                <li><strong>Personal Information:</strong> such as your name, email address, phone number, and profession.</li>
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
                <li><strong>Trusted Service Providers</strong> (e.g., Plaid, Firebase, Supabase) to operate our services securely.</li>
                <li><strong>Legal Authorities</strong> if required by law, regulation, or to protect rights and safety.</li>
              </ul>
            </div>

            <div>
              <h3>Data Security</h3>
              <p className="mb-3">
                We take the protection of your data seriously. Measures include:
              </p>
              <ul>
                <li>Bank-level encryption and secure connections.</li>
                <li>Access controls and regular security reviews.</li>
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
