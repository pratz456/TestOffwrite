"use client";

import React from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Info, ArrowLeft, Heart, Shield, HelpCircle, Users, GraduationCap, Smartphone } from 'lucide-react';
import Link from 'next/link';
import writeOffLogo from '@/public/writeofflogo.png';
import Image from 'next/image';

export default function AboutUsPageClient() {
  return (
    <div className="min-h-screen bg-background">
      <div className="bg-card border-b border-border">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Image src={writeOffLogo} alt="WriteOff" className="w-8 h-auto" />
              <h1 className="text-xl font-semibold tracking-tight text-foreground">About WriteOff</h1>
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

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-5">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Info className="w-5 h-5 text-green-600" />
              About WriteOff
            </CardTitle>
            <CardDescription>
              Expense and receipt organization for freelancers and small businesses
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm leading-relaxed text-muted-foreground">
            <div>
              <h3 className="text-base font-semibold text-foreground mb-2">Our Mission</h3>
              <p>
                Keeping business records should fit into your working day. WriteOff brings expenses,
                receipts and business notes together so you can review the details while they are fresh
                and prepare for a conversation with your tax preparer.
              </p>
            </div>

            <div>
              <h3 className="text-base font-semibold text-foreground mb-2">What We Do</h3>
              <p className="mb-3">
                With WriteOff, you can:
              </p>
              <ul className="list-disc list-inside space-y-1 ml-4">
                <li>Enter income and expenses manually</li>
                <li>Upload receipts and check the extracted merchant, date and amount</li>
                <li>Review AI category suggestions and add business-purpose notes</li>
                <li>Keep receipt attachments linked privately to your account</li>
                <li>Download your records archive on any plan</li>
                <li>Export supported PDF and CSV reports with a trial or Premium plan</li>
                <li>Review federal planning estimates for supported tax situations</li>
                <li>Use the web app on your phone or computer</li>
              </ul>
            </div>

            <div>
              <h3 className="text-base font-semibold text-foreground mb-2">What to Expect</h3>
              <p>
                Receipt text extraction helps reduce retyping, but you need to check the results.
                A saved purchase is not automatically a tax deduction. Federal estimates depend on
                reviewed facts and supported situations; missing information can require further review.
                AI suggests categories and explanations for your review. Bank activity can be connected
                through Plaid, subject to connection availability.
                WriteOff does not prepare a complete federal or state return or guarantee tax savings.
              </p>
            </div>

            <div>
              <h3 className="text-base font-semibold text-foreground mb-2">Why Choose WriteOff</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3">
                <div className="flex items-start gap-3">
                  <Heart className="w-5 h-5 text-red-500 mt-0.5 flex-shrink-0" />
                  <div>
                    <h4 className="font-medium text-foreground">User-First Design</h4>
                    <p className="text-xs">Built with professionals in mind, focusing on ease of use</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <Shield className="w-5 h-5 text-blue-500 mt-0.5 flex-shrink-0" />
                  <div>
                    <h4 className="font-medium text-foreground">Private Attachments</h4>
                    <p className="text-xs">Receipt viewing requires your authenticated account</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <HelpCircle className="w-5 h-5 text-green-500 mt-0.5 flex-shrink-0" />
                  <div>
                    <h4 className="font-medium text-foreground">Reviewable Details</h4>
                    <p className="text-xs">Check and correct receipt information before saving</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <GraduationCap className="w-5 h-5 text-purple-500 mt-0.5 flex-shrink-0" />
                  <div>
                    <h4 className="font-medium text-foreground">Planning Context</h4>
                    <p className="text-xs">Supported estimates include scope and review guidance</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <Smartphone className="w-5 h-5 text-cyan-500 mt-0.5 flex-shrink-0" />
                  <div>
                    <h4 className="font-medium text-foreground">Mobile-First</h4>
                    <p className="text-xs">PWA support with mobile-optimized design</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <Users className="w-5 h-5 text-purple-500 mt-0.5 flex-shrink-0" />
                  <div>
                    <h4 className="font-medium text-foreground">Preparer Handoff</h4>
                    <p className="text-xs">Export saved records for review with your accountant</p>
                  </div>
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-base font-semibold text-foreground mb-2">Get in Touch</h3>
              <p>
                Have questions or want to learn more? Get in touch.
                Contact us at <a href="mailto:writeoffapp@gmail.com" className="font-medium text-primary underline underline-offset-2">writeoffapp@gmail.com</a> or visit <Link href="/contact" className="font-medium text-primary underline underline-offset-2">support</Link>.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
