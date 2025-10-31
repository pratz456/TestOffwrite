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
              AI-powered tax optimization for modern professionals
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6 text-sm text-muted-foreground">
            <div>
              <h3 className="text-lg font-semibold text-foreground mb-3">Our Mission</h3>
              <p>
                At WriteOff, we believe that tax optimization shouldn't be complicated or time-consuming.
                Our mission is to empower professionals and small business owners with intelligent tools
                that automatically identify tax-saving opportunities and streamline expense management.
              </p>
            </div>

            <div>
              <h3 className="text-lg font-semibold text-foreground mb-3">What We Do</h3>
              <p className="mb-3">
                WriteOff is an AI-powered platform that helps you:
              </p>
              <ul className="list-disc list-inside space-y-1 ml-4">
                <li>Automatically categorize and analyze business expenses</li>
                <li>Identify tax-deductible items using advanced AI</li>
                <li>Generate comprehensive tax reports and analytics</li>
                <li>Streamline receipt management and organization</li>
                <li>Maximize your tax savings with intelligent insights</li>
              </ul>
            </div>

            <div>
              <h3 className="text-lg font-semibold text-foreground mb-3">Our Technology</h3>
              <p>
                We leverage cutting-edge artificial intelligence and machine learning to analyze your
                financial data and provide intelligent recommendations. Our platform integrates securely
                with major banks and financial institutions, ensuring your data is always protected.
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
                    <h4 className="font-medium text-foreground">Bank-Level Security</h4>
                    <p className="text-xs">Enterprise-grade security to protect your financial data</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <HelpCircle className="w-5 h-5 text-green-500 mt-0.5 flex-shrink-0" />
                  <div>
                    <h4 className="font-medium text-foreground">AI-Powered Insights</h4>
                    <p className="text-xs">Intelligent analysis to maximize your tax savings</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <Users className="w-5 h-5 text-purple-500 mt-0.5 flex-shrink-0" />
                  <div>
                    <h4 className="font-medium text-foreground">Expert Support</h4>
                    <p className="text-xs">Dedicated support team to help you succeed</p>
                  </div>
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-lg font-semibold text-foreground mb-3">Get in Touch</h3>
              <p>
                Have questions or want to learn more? We'd love to hear from you.
                Contact us at writeoffapp@gmail.com or visit our website at writeoff.com
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
