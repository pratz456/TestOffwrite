"use client";

import React, { useState, useEffect, Suspense } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { HelpCircle, Shield, Info, Mail, MessageCircle, BookOpen, CreditCard, FileText, Users, Heart, Camera, Calculator, TrendingUp, Smartphone, GraduationCap } from 'lucide-react';
import Link from 'next/link';
import writeOffLogo from '@/public/writeofflogo.png';
import Image from 'next/image';
import { useSearchParams } from 'next/navigation';
import { FAQSection } from '@/components/faq-section';
import { ContactSupportForm } from '@/components/contact-support-form';

function HelpPageContent() {
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState('help');

  // Handle URL parameters for direct tab navigation
  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab && ['help', 'privacy', 'about', 'faq', 'contact'].includes(tab)) {
      setActiveTab(tab);
    }
  }, [searchParams]);

  const handleTutorialClick = (tutorialType: string) => {
    // For now, these will open in new tabs/windows
    // In a real implementation, you'd integrate with the actual tutorial system
    switch (tutorialType) {
      case 'intro':
        window.open('/protected?tutorial=intro', '_blank');
        break;
      case 'plaid':
        window.open('/protected?tutorial=plaid', '_blank');
        break;
      case 'reports':
        window.open('/protected?tutorial=reports', '_blank');
        break;
      default:
        break;
    }
  };

  const handleContactSupport = () => {
    // Switch to contact tab
    setActiveTab('contact');
  };

  const handleFAQ = () => {
    // Switch to FAQ tab
    setActiveTab('faq');
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="bg-white border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Image src={writeOffLogo} alt="WriteOff" className="w-8 h-auto" />
              <h1 className="text-2xl font-bold text-foreground">Help & Support</h1>
            </div>
            <Link href="/">
              <Button variant="outline" size="sm">
                Back to Home
              </Button>
            </Link>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="grid w-full grid-cols-5">
            <TabsTrigger value="help" className="flex items-center gap-2">
              <HelpCircle className="w-4 h-4" />
              Help & Support
            </TabsTrigger>
            <TabsTrigger value="faq" className="flex items-center gap-2">
              <HelpCircle className="w-4 h-4" />
              FAQ
            </TabsTrigger>
            <TabsTrigger value="contact" className="flex items-center gap-2">
              <MessageCircle className="w-4 h-4" />
              Contact
            </TabsTrigger>
            <TabsTrigger value="privacy" className="flex items-center gap-2">
              <Shield className="w-4 h-4" />
              Privacy Policy
            </TabsTrigger>
            <TabsTrigger value="about" className="flex items-center gap-2">
              <Info className="w-4 h-4" />
              About Us
            </TabsTrigger>
          </TabsList>

          {/* Help & Support Tab */}
          <TabsContent value="help" className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {/* Getting Started */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <BookOpen className="w-5 h-5 text-blue-600" />
                    Getting Started
                  </CardTitle>
                  <CardDescription>
                    Learn the basics of using WriteOff
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    New to WriteOff? Start here to learn the fundamentals.
                  </p>
                  <Button 
                    className="w-full" 
                    size="sm"
                    onClick={() => handleTutorialClick('intro')}
                  >
                    View Tutorial
                  </Button>
                </CardContent>
              </Card>

              {/* Bank Connection */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <CreditCard className="w-5 h-5 text-green-600" />
                    Bank Connection
                  </CardTitle>
                  <CardDescription>
                    Connect your bank accounts securely
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Learn how to connect your bank accounts using Plaid.
                  </p>
                  <Button 
                    className="w-full" 
                    size="sm"
                    onClick={() => handleTutorialClick('plaid')}
                  >
                    View Guide
                  </Button>
                </CardContent>
              </Card>

              {/* Receipt Scanning */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Camera className="w-5 h-5 text-emerald-600" />
                    Receipt Scanning
                  </CardTitle>
                  <CardDescription>
                    Upload receipts for automatic processing
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Simply take a photo of your receipt and let AI extract all the details automatically.
                  </p>
                  <Button 
                    className="w-full" 
                    size="sm"
                    onClick={() => window.open('/protected?screen=receipt-upload', '_blank')}
                  >
                    Try Receipt Scan
                  </Button>
                </CardContent>
              </Card>

              {/* Quarterly Tax Calculator */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Calculator className="w-5 h-5 text-amber-600" />
                    Quarterly Tax Calculator
                  </CardTitle>
                  <CardDescription>
                    Real-time tax estimates and deadlines
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Get accurate quarterly tax estimates and never miss a payment deadline with real-time calculations.
                  </p>
                  <Button 
                    className="w-full" 
                    size="sm"
                    onClick={() => window.open('/protected?screen=quarterly-tax', '_blank')}
                  >
                    Calculate Quarterly Taxes
                  </Button>
                </CardContent>
              </Card>

              {/* AI Insights */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <TrendingUp className="w-5 h-5 text-rose-600" />
                    AI Insights
                  </CardTitle>
                  <CardDescription>
                    Personalized tax optimization tips
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Get personalized recommendations to maximize your tax savings with AI-powered insights.
                  </p>
                  <Button 
                    className="w-full" 
                    size="sm"
                    onClick={() => window.open('/protected?screen=ai-insights', '_blank')}
                  >
                    View AI Insights
                  </Button>
                </CardContent>
              </Card>

              {/* Reports & Analytics */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <FileText className="w-5 h-5 text-purple-600" />
                    Reports & Analytics
                  </CardTitle>
                  <CardDescription>
                    Understanding your tax reports
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Learn how to interpret your tax reports and analytics. AI learns from your corrections.
                  </p>
                  <Button 
                    className="w-full" 
                    size="sm"
                    onClick={() => handleTutorialClick('reports')}
                  >
                    Learn More
                  </Button>
                </CardContent>
              </Card>

              {/* Contact Support */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <MessageCircle className="w-5 h-5 text-orange-600" />
                    Contact Support
                  </CardTitle>
                  <CardDescription>
                    Get help from our support team
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Can't find what you're looking for? Contact our support team.
                  </p>
                  <Button 
                    className="w-full" 
                    size="sm"
                    onClick={handleContactSupport}
                  >
                    Contact Us
                  </Button>
                </CardContent>
              </Card>

              {/* FAQ */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <HelpCircle className="w-5 h-5 text-indigo-600" />
                    Frequently Asked Questions
                  </CardTitle>
                  <CardDescription>
                    Common questions and answers
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Find answers to the most common questions about WriteOff.
                  </p>
                  <Button 
                    className="w-full" 
                    size="sm"
                    onClick={handleFAQ}
                  >
                    View FAQ
                  </Button>
                </CardContent>
              </Card>

              {/* Tax Forms */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <FileText className="w-5 h-5 text-indigo-600" />
                    Tax Forms
                  </CardTitle>
                  <CardDescription>
                    Generate Schedule C and other tax forms
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Automatically generate Schedule C, Form 4562, and other tax forms from your expense data.
                  </p>
                  <Button 
                    className="w-full" 
                    size="sm"
                    onClick={() => window.open('/protected/schedule-c', '_blank')}
                  >
                    Generate Tax Forms
                  </Button>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* FAQ Tab */}
          <TabsContent value="faq" className="space-y-6">
            <FAQSection />
          </TabsContent>

          {/* Contact Support Tab */}
          <TabsContent value="contact" className="space-y-6">
            <ContactSupportForm />
          </TabsContent>

          {/* Privacy Policy Tab */}
          <TabsContent value="privacy" className="space-y-6">
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
                  <h3 className="text-lg font-semibold text-foreground mb-3">Information We Collect</h3>
                  <p className="mb-3">
                    We collect information you provide directly to us, such as when you create an account, 
                    connect your bank accounts, or upload receipts. This may include:
                  </p>
                  <ul className="list-disc list-inside space-y-1 ml-4">
                    <li>Personal information (name, email, profession, state)</li>
                    <li>Financial information through secure bank connections</li>
                    <li>Transaction data and receipts</li>
                    <li>Receipt images and OCR-extracted data</li>
                    <li>User corrections to AI classifications (for learning)</li>
                    <li>Quarterly tax calculation data</li>
                    <li>Mobile device information (for PWA functionality)</li>
                    <li>Notification preferences</li>
                    <li>Usage information and preferences</li>
                  </ul>
                </div>

                <div>
                  <h3 className="text-lg font-semibold text-foreground mb-3">How We Use Your Information</h3>
                  <p className="mb-3">
                    We use the information we collect to:
                  </p>
                  <ul className="list-disc list-inside space-y-1 ml-4">
                    <li>Provide and maintain our services</li>
                    <li>Process transactions and analyze expenses</li>
                    <li>Generate tax reports and analytics</li>
                    <li>Process receipts and extract transaction details</li>
                    <li>Calculate quarterly tax estimates and track deadlines</li>
                    <li>Provide personalized AI insights and recommendations</li>
                    <li>Learn from your corrections to improve AI accuracy</li>
                    <li>Personalize tax education content</li>
                    <li>Send quarterly tax deadline notifications</li>
                    <li>Improve our services and user experience</li>
                    <li>Communicate with you about updates and features</li>
                  </ul>
                </div>

                <div>
                  <h3 className="text-lg font-semibold text-foreground mb-3">Data Security</h3>
                  <p className="mb-3">
                    We implement industry-standard security measures to protect your personal and financial information. 
                    This includes encryption, secure connections, and regular security audits. We never share your 
                    personal information with third parties without your explicit consent.
                  </p>
                  <p>
                    We work with trusted third-party services including OCR processing providers and AI models 
                    for receipt processing and insights generation. All data processing is done securely and 
                    in compliance with applicable privacy regulations.
                  </p>
                </div>

                <div>
                  <h3 className="text-lg font-semibold text-foreground mb-3">Your Rights</h3>
                  <p className="mb-3">
                    You have the right to:
                  </p>
                  <ul className="list-disc list-inside space-y-1 ml-4">
                    <li>Access and update your personal information</li>
                    <li>Request deletion of your data</li>
                    <li>Opt-out of certain communications</li>
                    <li>Disconnect your bank accounts at any time</li>
                  </ul>
                </div>

                <div>
                  <h3 className="text-lg font-semibold text-foreground mb-3">Contact Us</h3>
                  <p>
                    If you have any questions about this Privacy Policy or our data practices, 
                    please contact us at writeoffapp@gmail.com
                  </p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* About Us Tab */}
          <TabsContent value="about" className="space-y-6">
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
                    <li>Automatically categorize and analyze business expenses with AI</li>
                    <li>Identify tax-deductible items using advanced machine learning</li>
                    <li>Scan and process receipts automatically with OCR technology</li>
                    <li>Calculate quarterly tax estimates with real-time federal tax brackets</li>
                    <li>Provide personalized AI insights and tax optimization recommendations</li>
                    <li>Learn from your corrections to improve AI accuracy over time</li>
                    <li>Generate Schedule C, Form 4562, and other tax forms automatically</li>
                    <li>Voice input for hands-free expense tracking</li>
                    <li>Mobile-responsive design with PWA support</li>
                    <li>Bank account integration via Plaid for automatic transaction import</li>
                    <li>Comprehensive tax education with IRS-backed content</li>
                    <li>Real-time tax savings calculations based on your specific tax bracket</li>
                    <li>Smart notifications for quarterly tax deadlines</li>
                    <li>Secure, bank-level encryption for all financial data</li>
                  </ul>
                </div>

                <div>
                  <h3 className="text-lg font-semibold text-foreground mb-3">Our Technology</h3>
                  <p>
                    We leverage cutting-edge artificial intelligence and machine learning to analyze your 
                    financial data and provide intelligent recommendations. Our platform features advanced 
                    OCR for receipt processing, machine learning that adapts to user preferences, real-time 
                    tax calculations, and IRS publication integration for education. We integrate securely 
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
                        <h4 className="font-medium text-foreground">Smart Learning</h4>
                        <p className="text-xs">AI that improves over time based on your corrections</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <GraduationCap className="w-5 h-5 text-purple-500 mt-0.5 flex-shrink-0" />
                      <div>
                        <h4 className="font-medium text-foreground">Tax Education</h4>
                        <p className="text-xs">Comprehensive tax education built-in with IRS content</p>
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
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

export default function HelpPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <HelpPageContent />
    </Suspense>
  );
}
