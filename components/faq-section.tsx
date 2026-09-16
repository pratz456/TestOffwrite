"use client";

import React, { useState, useRef, useLayoutEffect, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ChevronDown, HelpCircle } from 'lucide-react';

interface FAQItem {
  question: string;
  answer: string;
  category: string;
}

const faqData: FAQItem[] = [
  {
    question: "What is WriteOff?",
    answer: "WriteOff helps freelancers and small business owners organize expenses, review receipts, and export records for a tax preparer. Federal planning estimates are available for supported situations; the app does not prepare or file a complete tax return.",
    category: "general"
  },
  {
    question: "How does WriteOff work?",
    answer: "Set up your work profile, enter an expense or upload a receipt, then review the amount, date, category and business purpose. You can download your records archive on any plan or use report exports with a trial or Premium plan. No bank connection is required to get started.",
    category: "general"
  },
  {
    question: "Who can access my receipts and records?",
    answer: "Your saved records and receipt attachments require your authenticated account. Receipt links are private account links, not sharing links for an accountant. Downloaded exports contain your information, so choose carefully where you store or share them. See the Privacy Policy for data-handling details.",
    category: "security"
  },
  {
    question: "Can I connect a bank account?",
    answer: "Bank connections are not available in this preview. You can enter income and expenses manually and upload receipts.",
    category: "banking"
  },
  {
    question: "Is AI categorization available?",
    answer: "AI analysis is not available in this preview. You can review and edit categories yourself. Receipt text extraction can make mistakes, so check the merchant, date and amount before saving; it does not determine whether an expense is deductible.",
    category: "ai"
  },
  {
    question: "What types of expenses can I track?",
    answer: "You can record expenses such as supplies, travel, meals, equipment and software. Recording a purchase or selecting a category does not establish that it is deductible. Keep its business purpose and supporting receipt for review.",
    category: "expenses"
  },
  {
    question: "Can I upload receipts?",
    answer: "Yes. Upload a receipt, review the extracted merchant, date and amount, and correct any mistakes before saving. Receipt files stay linked privately to your account and are not bundled in the records archive.",
    category: "features"
  },
  {
    question: "What tax reports does WriteOff generate?",
    answer: "Trial and Premium plans include supported Schedule C summaries, transaction CSVs, cash-flow reports and planning worksheets. Missing or unsupported tax facts can require review before an estimate or worksheet is available. These exports are records for review, not official filed returns; in-app filing is unavailable.",
    category: "reports"
  },
  {
    question: "Is WriteOff suitable for my business type?",
    answer: "Expense and receipt organization can help freelancers and small business owners. Federal estimates cover only supported individual tax situations, including certain simple Schedule C cases. Complex businesses, credits and other special facts need separate professional review. The app does not prepare state or business-entity returns.",
    category: "general"
  },
  {
    question: "How much does WriteOff cost?",
    answer: "The Free plan keeps basic records and the records archive accessible. The 30-day trial and Premium plans unlock reports and exports. Listed Premium pricing is $14.99 monthly or $150 yearly. AI analysis, bank connections and filing are unavailable in the current preview; do not choose a plan expecting those features.",
    category: "pricing"
  }
];

const DURATION_MS = 220;
const EASING = 'cubic-bezier(0.2, 0.8, 0.2, 1)';

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const handler = () => setReduced(mq.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return reduced;
}

function FAQAccordionItem({
  item,
  index,
  isOpen,
  onToggle,
  durationMs,
  reducedMotion,
}: {
  item: FAQItem;
  index: number;
  isOpen: boolean;
  onToggle: () => void;
  durationMs: number;
  reducedMotion: boolean;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);

  useLayoutEffect(() => {
    if (!contentRef.current) return;
    if (isOpen) {
      setHeight(contentRef.current.scrollHeight);
    } else {
      setHeight(0);
    }
  }, [isOpen, item.answer]);

  const duration = reducedMotion ? 0 : durationMs;
  const transition = `height ${duration}ms ${EASING}`;
  const contentTransition = reducedMotion ? 'none' : `opacity ${duration}ms ${EASING}, transform ${duration}ms ${EASING}`;
  const chevronTransition = reducedMotion ? 'none' : `transform ${duration}ms ${EASING}`;

  const answerId = `faq-answer-${index}`;
  const questionId = `faq-question-${index}`;

  return (
    <Card className="overflow-hidden">
      <CardHeader className="p-0">
        <button
          type="button"
          id={questionId}
          aria-expanded={isOpen}
          aria-controls={answerId}
          onClick={onToggle}
          className="w-full cursor-pointer hover:bg-muted/50 transition-colors text-left flex items-center justify-between gap-3 px-6 py-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-t-lg"
        >
          <CardTitle className="text-base font-medium text-foreground">
            {item.question}
          </CardTitle>
          <span
            className="shrink-0 inline-flex items-center justify-center h-6 w-6"
            style={{ transition: chevronTransition }}
            aria-hidden
          >
            <ChevronDown
              className="h-4 w-4"
              style={{ transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}
            />
          </span>
        </button>
      </CardHeader>
      <div
        style={{
          height,
          overflow: 'hidden',
          transition,
        }}
      >
        <div
          ref={contentRef}
          id={answerId}
          role="region"
          aria-labelledby={questionId}
          style={{
            opacity: isOpen ? 1 : 0,
            transform: isOpen ? 'translateY(0)' : 'translateY(2px)',
            transition: contentTransition,
          }}
        >
          <CardContent className="pt-0 pb-4">
            <p className="text-sm text-muted-foreground leading-relaxed">
              {item.answer}
            </p>
          </CardContent>
        </div>
      </div>
    </Card>
  );
}

export function FAQSection() {
  const [expandedItems, setExpandedItems] = useState<Set<number>>(new Set());
  const reducedMotion = useReducedMotion();

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
          <FAQAccordionItem
            key={index}
            item={item}
            index={index}
            isOpen={expandedItems.has(index)}
            onToggle={() => toggleItem(index)}
            durationMs={DURATION_MS}
            reducedMotion={reducedMotion}
          />
        ))}
      </div>

      {/* Still Need Help */}
      <Card className="bg-muted/50 border-border dark:bg-card dark:border-border">
        <CardContent className="pt-6">
          <div className="text-center space-y-3">
            <HelpCircle className="w-8 h-8 text-primary mx-auto" />
            <h3 className="text-lg font-semibold text-foreground">Still Need Help?</h3>
            <p className="text-sm text-muted-foreground">
              Have another question? Contact us or browse the Help Center.
            </p>
            <div className="flex gap-3 justify-center flex-wrap">
              <Button
                size="sm"
                className="bg-primary text-primary-foreground hover:bg-primary/90"
                asChild
              >
                <a href="/contact">Contact Support</a>
              </Button>
              <Button variant="outline" size="sm" className="border-border text-foreground hover:bg-muted" asChild>
                <a href="/help" target="_blank" rel="noopener noreferrer">
                  View Help Center
                </a>
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
