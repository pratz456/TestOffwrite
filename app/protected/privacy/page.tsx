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
      <div className="bg-white border-b border-border">
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

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="w-5 h-5 text-blue-600" />
              Privacy Policy
            </CardTitle>
            <CardDescription>
              Last updated: {new Date().toLocaleDateString()}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6 text-sm text-muted-foreground">
            <div>
              <p className="mb-4">
                At WriteOff ("we," "our," or "us"), we value your privacy and are committed to protecting your personal and financial information. This Privacy Policy explains what information we collect, how we use it, and the choices you have regarding your data.
              </p>
            </div>

            <div>
              <h3 className="text-lg font-semibold text-foreground mb-3">Information We Collect</h3>
              <p className="mb-3">
                We may collect the following types of information:
              </p>
              <ul className="list-disc list-inside space-y-2 ml-4">
                <li><strong>Personal Information:</strong> such as your name, email address, phone number, and profession.</li>
                <li><strong>Financial Information:</strong> securely obtained through bank connections (via trusted partners like Plaid).</li>
                <li><strong>Transaction Data:</strong> including purchase history, expenses, and uploaded receipts.</li>
                <li><strong>Usage Data:</strong> such as device information, app interactions, and preferences.</li>
              </ul>
            </div>

            <div>
              <h3 className="text-lg font-semibold text-foreground mb-3">How We Use Your Information</h3>
              <p className="mb-3">
                We use your information to:
              </p>
              <ul className="list-disc list-inside space-y-1 ml-4">
                <li>Provide, maintain, and improve our services.</li>
                <li>Process transactions and analyze expenses.</li>
                <li>Generate tax reports, insights, and personalized analytics.</li>
                <li>Communicate with you about product updates, features, and support.</li>
                <li>Ensure security, detect fraud, and comply with legal obligations.</li>
              </ul>
            </div>

            <div>
              <h3 className="text-lg font-semibold text-foreground mb-3">How We Share Information</h3>
              <p className="mb-3">
                We do not sell or rent your personal information. We may share information only with:
              </p>
              <ul className="list-disc list-inside space-y-1 ml-4">
                <li><strong>Trusted Service Providers</strong> (e.g., Plaid, Firebase, Supabase) to operate our services securely.</li>
                <li><strong>Legal Authorities</strong> if required by law, regulation, or to protect rights and safety.</li>
              </ul>
            </div>

            <div>
              <h3 className="text-lg font-semibold text-foreground mb-3">Data Security</h3>
              <p className="mb-3">
                We take the protection of your data seriously. Measures include:
              </p>
              <ul className="list-disc list-inside space-y-1 ml-4">
                <li>Bank-level encryption and secure connections.</li>
                <li>Access controls and regular security reviews.</li>
                <li>Partnerships with audited and compliant service providers.</li>
              </ul>
              <p className="mt-3">
                While no system is 100% secure, we continuously work to safeguard your data.
              </p>
            </div>

            <div>
              <h3 className="text-lg font-semibold text-foreground mb-3">Your Rights</h3>
              <p className="mb-3">
                You have the right to:
              </p>
              <ul className="list-disc list-inside space-y-1 ml-4">
                <li>Access, update, or correct your personal information.</li>
                <li>Request deletion of your data.</li>
                <li>Disconnect your bank accounts at any time.</li>
                <li>Opt-out of marketing communications.</li>
              </ul>
              <p className="mt-3">
                To exercise these rights, contact us at <a href="mailto:writeoffapp@gmail.com" className="text-blue-600 hover:underline">writeoffapp@gmail.com</a>.
              </p>
            </div>

            <div>
              <h3 className="text-lg font-semibold text-foreground mb-3">Children's Privacy</h3>
              <p>
                Our services are not directed to individuals under 13, and we do not knowingly collect data from children.
              </p>
            </div>

            <div>
              <h3 className="text-lg font-semibold text-foreground mb-3">Changes to This Policy</h3>
              <p>
                We may update this Privacy Policy from time to time. If significant changes are made, we will notify you by updating the "Last Updated" date and, when appropriate, through direct communication.
              </p>
            </div>

            <div>
              <h3 className="text-lg font-semibold text-foreground mb-3">Contact Us</h3>
              <p>
                For questions or concerns about this Privacy Policy or our data practices, please email us at <a href="mailto:writeoffapp@gmail.com" className="text-blue-600 hover:underline">writeoffapp@gmail.com</a>.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
