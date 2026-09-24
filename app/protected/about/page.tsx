"use client";

import React from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Heart, Shield, HelpCircle, Users } from 'lucide-react';
import Link from 'next/link';

export default function AboutUsPage() {
  return (
    <div className="min-h-full bg-background">
      <header className="border-b border-border bg-background">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight text-foreground">About WriteOff</h1>
            <p className="mt-1 text-sm text-muted-foreground">Expense and deduction records for freelancers and small business owners</p>
          </div>
          <Button asChild variant="outline" size="sm" className="shrink-0">
            <Link href="/protected" aria-label="Back to dashboard">Back</Link>
          </Button>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-4">
        <Card>
          <CardContent className="grid items-start gap-5 p-4 text-sm leading-6 text-muted-foreground md:grid-cols-2">
            <div>
              <h3 className="text-sm font-semibold text-foreground mb-2">Our Mission</h3>
              <p>
                At WriteOff, we believe that keeping deduction records shouldn't be complicated or time-consuming.
                Our mission is to give professionals and small business owners tools that organize expenses,
                suggest possible deductions for review and keep the records a tax preparer needs.
              </p>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-foreground mb-2">What We Do</h3>
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
              <h3 className="text-sm font-semibold text-foreground mb-2">Our Technology</h3>
              <p>
                We use AI models to suggest categories and possible tax treatments, and published federal
                tax parameters for planning estimates. Every suggestion is shown for your review; nothing is
                treated as deductible until you confirm it. Bank connections run through Plaid with read-only access.
              </p>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-foreground mb-2">Why Choose WriteOff</h3>
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

            <div className="border-t border-border pt-3 md:col-span-2">
              <h3 className="text-sm font-semibold text-foreground mb-2">Get in Touch</h3>
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
