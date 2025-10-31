'use client';

import { JobProgress } from '@/components/JobProgress';

export function PlaidProgress({ accountId }: { accountId: string }) {
  return (
    // Keep this component minimal - the parent (`plaid-link-screen`) already renders
    // the "Bank Connected!" header and surrounding card. Render only the job progress
    // so we don't duplicate headings or introduce extra layout centering.
    <div className="w-full">
      <JobProgress accountId={accountId} />
    </div>
  );
}
