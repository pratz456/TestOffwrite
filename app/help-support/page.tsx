"use client";

import React from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { HelpCircle, ArrowLeft, BookOpen, CreditCard, FileText, MessageCircle, Users } from 'lucide-react';
import Link from 'next/link';
import writeOffLogo from '@/public/writeofflogo.png';
import Image from 'next/image';

export default function HelpSupportPage() {
  const handleTutorialClick = (tutorialType: string) => {
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
    window.location.href = 'mailto:writeoffapp@gmail.com?subject=WriteOff Support Request';
  };

  const handleFAQ = () => {
    window.location.href = '/help?tab=faq';
  };

  const handleCommunity = () => {
    alert('Community features coming soon!');
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="bg-white border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Image src={writeOffLogo} alt="WriteOff" className="w-8 h-auto" />
              <h1 className="text-2xl font-bold text-foreground">Help & Support</h1>
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

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="text-center space-y-2 mb-8">
          <h2 className="text-3xl font-bold text-foreground">How can we help you?</h2>
          <p className="text-lg text-muted-foreground">
            Get help, learn about our platform, and find answers to your questions
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
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
                Learn how to interpret your tax reports and analytics.
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

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="w-5 h-5 text-teal-600" />
                Community
              </CardTitle>
              <CardDescription>
                Connect with other users
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Join our community to share tips and get help from other users.
              </p>
              <Button
                className="w-full"
                size="sm"
                onClick={handleCommunity}
              >
                Join Community
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Additional Help Resources */}
        <div className="mt-12">
          <Card className="bg-blue-50 border-blue-200">
            <CardContent className="pt-6">
              <div className="text-center space-y-3">
                <HelpCircle className="w-8 h-8 text-blue-600 mx-auto" />
                <h3 className="text-lg font-semibold text-blue-900">Still Need Help?</h3>
                <p className="text-sm text-blue-700">
                  Can't find the answer you're looking for? Our support team is here to help.
                </p>
                <div className="flex gap-3 justify-center">
                  <Button
                    size="sm"
                    className="bg-blue-600 hover:bg-blue-700 text-white"
                    onClick={handleContactSupport}
                  >
                    Contact Support
                  </Button>
                  <Link href="/help">
                    <Button
                      variant="outline"
                      size="sm"
                      className="border-blue-300 text-blue-700 hover:bg-blue-100"
                    >
                      View Help Center
                    </Button>
                  </Link>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
