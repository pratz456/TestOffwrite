"use client";

import React from 'react';
import { Card } from '@/components/ui/card';

/** Retained for compatibility; no supported caller supplies a full-return counterfactual. */
export const TaxSavingsChart: React.FC<{ transactions?: unknown[] }> = () => (
  <Card className="p-4 text-sm text-muted-foreground">
    Tax savings depend on your full return. Open Tax Preview to review the federal estimate based on your confirmed records.
  </Card>
);

export default TaxSavingsChart;
