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
            <Link href="/">
              <Button variant="outline" size="sm">
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back to Home
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
              Last updated: September 11, 2025
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6 text-sm text-muted-foreground">
            <div>
              <p className="mb-4">
                At WriteOff, we value your privacy and are committed to protecting your personal and financial information. This Privacy Policy explains what information we collect, how we use it, and the choices you have regarding your data.
              </p>
            </div>

            <div>
              <h3 className="text-lg font-semibold text-foreground mb-3">Categories of Data We Collect</h3>
              <ul className="list-disc list-inside space-y-2 ml-4">
                <li><strong>Personal Information:</strong> name, email address, state, profession, filing status, income</li>
                <li><strong>Financial Data:</strong> bank account and transaction data via Plaid integration</li>
                <li><strong>Receipt Data:</strong> receipt images and OCR-extracted transaction details</li>
                <li><strong>User Corrections:</strong> corrections to AI classifications for machine learning improvement</li>
                <li><strong>Tax Data:</strong> quarterly tax calculation data, payment tracking, and tax bracket information</li>
                <li><strong>Mobile Data:</strong> device information for PWA functionality and mobile optimization</li>
                <li><strong>Preferences:</strong> notification settings, user preferences, and customization data</li>
                <li><strong>Voice Data:</strong> voice input for expense tracking (processed locally when possible)</li>
                <li><strong>Usage Analytics:</strong> app usage patterns, feature interactions, and performance data</li>
                <li><strong>Inferences:</strong> tax deduction analysis, personalized insights, and optimization recommendations</li>
              </ul>
            </div>

            <div>
              <h3 className="text-lg font-semibold text-foreground mb-3">Purposes of Collection</h3>
              <ul className="list-disc list-inside space-y-1 ml-4">
                <li>To provide AI-powered tax deduction analysis and generate comprehensive reports</li>
                <li>To automatically process receipts and extract transaction details using OCR</li>
                <li>To calculate quarterly tax estimates using real-time federal tax brackets</li>
                <li>To provide personalized AI insights and tax optimization recommendations</li>
                <li>To learn from your corrections and improve AI accuracy over time</li>
                <li>To generate Schedule C, Form 4562, and other tax forms automatically</li>
                <li>To process voice input for hands-free expense tracking</li>
                <li>To provide mobile-responsive experience with PWA functionality</li>
                <li>To integrate with bank accounts via Plaid for automatic transaction import</li>
                <li>To personalize tax education content and deliver IRS-backed information</li>
                <li>To send smart notifications for quarterly tax deadlines and important updates</li>
                <li>To provide real-time tax savings calculations based on your specific tax bracket</li>
                <li>To manage your account and provide comprehensive customer support</li>
                <li>To improve our services, user experience, and AI capabilities</li>
                <li>To comply with legal obligations and maintain security standards</li>
              </ul>
            </div>

            <div>
              <h3 className="text-lg font-semibold text-foreground mb-3">Data Retention</h3>
              <p className="mb-3">
                We retain your data as long as your account is active or as needed to provide services, comply with legal obligations, or resolve disputes. You may request deletion at any time.
              </p>
            </div>

            <div>
              <h3 className="text-lg font-semibold text-foreground mb-3">Third Parties</h3>
              <ul className="list-disc list-inside space-y-1 ml-4">
                <li>Plaid (for bank data aggregation)</li>
                <li>Firebase (for authentication, storage, and hosting)</li>
                <li>OCR processing providers (for receipt scanning)</li>
                <li>AI models (for receipt processing and insights generation)</li>
                <li>Other service providers as required to operate our service</li>
              </ul>
            </div>

            <div>
              <h3 className="text-lg font-semibold text-foreground mb-3">Security Measures</h3>
              <ul className="list-disc list-inside space-y-1 ml-4">
                <li>Bank-level encryption and secure connections</li>
                <li>Access controls and regular security reviews</li>
                <li>Partnerships with audited and compliant service providers</li>
                <li>Secure processing of receipt images and OCR data</li>
                <li>Protected AI model training with user corrections</li>
              </ul>
              <p className="mt-3">
                While no system is 100% secure, we continuously work to safeguard your data. 
                All data processing is done securely and in compliance with applicable privacy regulations.
              </p>
            </div>

            <div>
              <h3 className="text-lg font-semibold text-foreground mb-3">GLBA Privacy Rule</h3>
              <p className="mb-3">
                We do not share your nonpublic personal information with non-affiliated third parties except as permitted by law. You have the right to opt out of any such sharing, but we do not engage in it.
              </p>
            </div>

            <div>
              <h3 className="text-lg font-semibold text-foreground mb-3">Data Processing & Compliance</h3>
              <p className="mb-3">
                We use Google Firebase, which provides data processing and compliance in accordance with applicable laws. See <a href="https://firebase.google.com/support/privacy" className="underline text-blue-600" target="_blank" rel="noopener noreferrer">Firebase Privacy & Compliance</a>.
              </p>
            </div>

            <div>
              <h3 className="text-lg font-semibold text-foreground mb-3">Your Rights</h3>
              <ul className="list-disc list-inside space-y-1 ml-4">
                <li>View and export your data</li>
                <li>Request deletion of your account and data</li>
                <li>Revoke access to your bank data via Plaid</li>
              </ul>
              <p className="mt-3">
                To exercise these rights, visit the Data Rights section in your account settings or contact us at <a href="mailto:writeoffapp@gmail.com" className="text-blue-600 hover:underline">writeoffapp@gmail.com</a>.
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
