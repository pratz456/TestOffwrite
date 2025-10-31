"use client";

import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ChevronDown, ChevronUp, HelpCircle } from 'lucide-react';

interface FAQItem {
  question: string;
  answer: string;
  category: string;
}

const faqData: FAQItem[] = [
  {
    question: "What is WriteOff?",
    answer: "WriteOff is an AI-powered tax optimization platform that helps professionals and small business owners automatically categorize expenses, identify tax-deductible items, and generate comprehensive tax reports to maximize their tax savings.",
    category: "general"
  },
  {
    question: "How does WriteOff work?",
    answer: "WriteOff connects to your bank accounts securely through Plaid, automatically categorizes your transactions using AI, identifies potential tax deductions, and generates detailed reports for tax filing. You can also manually review and adjust categorizations.",
    category: "general"
  },
  {
    question: "Is my financial data secure?",
    answer: "Yes, absolutely. We use bank-level security with end-to-end encryption, secure connections through Plaid, and never store your banking credentials. All data is encrypted and protected by industry-standard security measures.",
    category: "security"
  },
  {
    question: "Which banks does WriteOff support?",
    answer: "WriteOff supports thousands of banks and credit unions through our Plaid integration, including major banks like Chase, Bank of America, Wells Fargo, and many regional and online banks.",
    category: "banking"
  },
  {
    question: "How accurate is the AI categorization?",
    answer: "Our AI achieves over 90% accuracy in expense categorization. The system learns from your corrections and improves over time. You can always manually review and adjust any categorizations.",
    category: "ai"
  },
  {
    question: "What types of expenses can I track?",
    answer: "You can track all types of business expenses including office supplies, travel, meals, equipment, software subscriptions, professional development, and more. The system automatically identifies which expenses are tax-deductible.",
    category: "expenses"
  },
  {
    question: "Can I upload receipts?",
    answer: "Yes! You can upload receipts and invoices directly to WriteOff. Our AI will extract key information like amounts, dates, and merchants to help with expense tracking and categorization.",
    category: "features"
  },
  {
    question: "What tax reports does WriteOff generate?",
    answer: "WriteOff generates comprehensive reports including Schedule C summaries, expense breakdowns by category, monthly and yearly summaries, and detailed analytics to help you maximize your tax deductions.",
    category: "reports"
  },
  {
    question: "Is WriteOff suitable for my business type?",
    answer: "WriteOff is designed for freelancers, consultants, small business owners, and professionals who want to optimize their tax situation. It works with various business structures and filing statuses.",
    category: "general"
  },
  {
    question: "How much does WriteOff cost?",
    answer: "We offer flexible pricing plans starting with a free tier for basic expense tracking. Premium plans include advanced features like unlimited transactions, priority support, and advanced analytics.",
    category: "pricing"
  }
];

export function FAQSection() {
  const [expandedItems, setExpandedItems] = useState<Set<number>>(new Set());

  const toggleItem = (index: number) => {
    const newExpanded = new Set(expandedItems);
    if (newExpanded.has(index)) {
      newExpanded.delete(index);
    } else {
      newExpanded.add(index);
    }
    setExpandedItems(newExpanded);
  };

  return (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <h2 className="text-2xl font-bold text-foreground">Frequently Asked Questions</h2>
        <p className="text-muted-foreground">
          Find answers to the most common questions about WriteOff
        </p>
      </div>

      {/* FAQ Items */}
      <div className="space-y-4">
        {faqData.map((item, index) => (
          <Card key={index} className="overflow-hidden">
            <CardHeader 
              className="cursor-pointer hover:bg-muted/50 transition-colors"
              onClick={() => toggleItem(index)}
            >
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-medium text-foreground">
                  {item.question}
                </CardTitle>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0 hover:bg-transparent"
                >
                  {expandedItems.has(index) ? (
                    <ChevronUp className="h-4 w-4" />
                  ) : (
                    <ChevronDown className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </CardHeader>
            {expandedItems.has(index) && (
              <CardContent className="pt-0 pb-4">
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {item.answer}
                </p>
              </CardContent>
            )}
          </Card>
        ))}
      </div>

      {/* Still Need Help */}
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
                onClick={() => window.location.href = 'mailto:writeoffapp@gmail.com?subject=WriteOff Support Request'}
              >
                Contact Support
              </Button>
              <Button 
                variant="outline" 
                size="sm"
                className="border-blue-300 text-blue-700 hover:bg-blue-100"
                onClick={() => window.open('/protected/help', '_blank')}
              >
                View Help Center
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
