"use client";

import React from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Info, ArrowLeft, Heart, Shield, HelpCircle, Users } from 'lucide-react';
import Link from 'next/link';
import writeOffLogo from '@/public/writeofflogo.png';
import Image from 'next/image';

export default function AboutUsPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="bg-white border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Image src={writeOffLogo} alt="WriteOff" className="w-8 h-auto" />
              <h1 className="text-2xl font-bold text-foreground">About WriteOff</h1>
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
              <Info className="w-5 h-5 text-green-600" />
              About WriteOff
            </CardTitle>
            <CardDescription>
              Expense and deduction records for freelancers and small business owners
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6 text-sm text-muted-foreground">
            <div>
              <h3 className="text-lg font-semibold text-foreground mb-3">Our Mission</h3>
              <p>
                At WriteOff, we believe that keeping deduction records shouldn't be complicated or time-consuming.
                Our mission is to give professionals and small business owners tools that organize expenses,
                suggest possible deductions for review and keep the records a tax preparer needs.
              </p>
            </div>

            <div>
              <h3 className="text-lg font-semibold text-foreground mb-3">What We Do</h3>
              <p className="mb-3">
                WriteOff helps you:
              </p>
              <ul className="list-disc list-inside space-y-1 ml-4">
                <li>Record and categorize business expenses, with AI suggestions where enabled</li>
                <li>Flag possible deductions and the facts still needed for your review</li>
                <li>Build Schedule C summaries and exports your preparer can use</li>
                <li>Keep receipts linked to the expenses they support</li>
                <li>See federal planning estimates for supported situations</li>
              </ul>
            </div>

            <div>
              <h3 className="text-lg font-semibold text-foreground mb-3">Our Technology</h3>
              <p>
                We use AI models to suggest categories and possible tax treatments, and published federal
                tax parameters for planning estimates. Every suggestion is shown for your review; nothing is
                treated as deductible until you confirm it. Bank connections run through Plaid with read-only access.
              </p>
            </div>

            <div>
              <h3 className="text-lg font-semibold text-foreground mb-3">Why Choose WriteOff</h3>
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
                    <h4 className="font-medium text-foreground">Encrypted Data</h4>
                    <p className="text-xs">Encrypted connections and storage; read-only bank access through Plaid</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <HelpCircle className="w-5 h-5 text-green-500 mt-0.5 flex-shrink-0" />
                  <div>
                    <h4 className="font-medium text-foreground">Suggestions You Review</h4>
                    <p className="text-xs">Possible deductions and missing facts flagged for your confirmation</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <Users className="w-5 h-5 text-purple-500 mt-0.5 flex-shrink-0" />
                  <div>
                    <h4 className="font-medium text-foreground">Support</h4>
                    <p className="text-xs">Email support for account and product questions (not tax advice)</p>
                  </div>
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-lg font-semibold text-foreground mb-3">Get in Touch</h3>
              <p>
                Have questions or want to learn more? We'd love to hear from you.
                Contact us at writeoffapp@gmail.com or visit our website at writeoffapp.com
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
