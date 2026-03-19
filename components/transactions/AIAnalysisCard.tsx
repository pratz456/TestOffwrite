'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { BookOpen } from 'lucide-react';
import { TaxEducationModal } from '@/components/tax-education-modal';

type AI = {
  status_label?: string | null;
  score_pct?: number | null; // 0..100
  reasoning?: string | null;
  irs?: { publication?: string|null; section?: string|null } | null;
  required_docs?: string[];
  last_analyzed_at?: number | null;
};

interface AIAnalysisCardProps {
  ai: AI | null | undefined;
  transaction?: {
    merchant_name: string;
    amount: number;
    category: string;
    is_deductible: boolean;
    deductible_reason?: string;
    ai?: {
      reasoning?: string;
      irs?: {
        publication?: string;
        section?: string;
      };
    };
  };
  userProfile?: {
    profession: string;
    business_entity_type: string;
    state: string;
  };
}

export default function AIAnalysisCard({ ai, transaction, userProfile }: AIAnalysisCardProps) {
  const [isEducationModalOpen, setIsEducationModalOpen] = useState(false);
  if (!ai) return null;
  const pct = typeof ai.score_pct === 'number' ? Math.max(0, Math.min(100, ai.score_pct)) : null;

  return (
    <div className="rounded-2xl border bg-white p-4 md:p-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">AI Analysis</h3>
        <span className="text-sm text-muted-foreground">{ai.status_label ?? '-'}</span>
      </div>

      {/* Progress */}
      {typeof pct === 'number' && (
        <div className="mt-3">
          <div className="mb-1 flex justify-between text-sm">
            <span>Deduction Status</span>
            <span>{pct}%</span>
          </div>
          <div className="h-2 w-full rounded bg-neutral-200">
            <div
              className="h-2 rounded bg-emerald-500"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}

      {/* Reasoning */}
      {ai.reasoning && (
        <div className="mt-5">
          <div className="font-medium mb-1">Reasoning</div>
          <p className="text-sm text-muted-foreground">{ai.reasoning}</p>
        </div>
      )}

      {/* IRS Reference */}
      {(ai.irs?.publication || ai.irs?.section) && (
        <div className="mt-5">
          <div className="font-medium mb-1">IRS Reference</div>
          <div className="text-sm text-muted-foreground">
            {ai.irs?.publication ? `Publication: ${ai.irs.publication}` : null}
            {ai.irs?.publication && ai.irs?.section ? ' • ' : null}
            {ai.irs?.section ? `Section: ${ai.irs.section}` : null}
          </div>
        </div>
      )}

      {/* Suggested Docs */}
      {ai.required_docs && ai.required_docs.length > 0 && (
        <div className="mt-5">
          <div className="font-medium mb-1">Suggested Documentation</div>
          <ul className="list-disc pl-5 text-sm text-muted-foreground space-y-1">
            {ai.required_docs.map((d, i) => <li key={i}>{d}</li>)}
          </ul>
        </div>
      )}


      {/* Learn More Button */}
      {transaction && (
        <div className="mt-5">
          <Button 
            variant="outline" 
            size="sm" 
            onClick={() => setIsEducationModalOpen(true)}
            className="w-full"
          >
            <BookOpen className="h-4 w-4 mr-2" />
            Learn More About This Deduction
          </Button>
        </div>
      )}

      {/* Footer */}
      {ai.last_analyzed_at && (
        <div className="mt-6 text-xs text-muted-foreground">
          Last analyzed: {new Date(ai.last_analyzed_at).toLocaleString()}
        </div>
      )}

      {/* Tax Education Modal */}
      <TaxEducationModal
        isOpen={isEducationModalOpen}
        onClose={() => setIsEducationModalOpen(false)}
        transaction={transaction}
        userProfile={userProfile}
      />
    </div>
  );
}

