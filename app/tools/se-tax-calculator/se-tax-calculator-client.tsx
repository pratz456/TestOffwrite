"use client";

import React, { useState, useMemo } from "react";
import Link from "next/link";
import { Calculator, DollarSign, Info, ArrowRight } from "lucide-react";
import { LandingHeader } from "@/components/landing/landing-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { assertWageOwnershipScope } from "@/lib/tax-rules/calculation-scope";
import { calcScheduleSE } from "@/lib/reports/calcSE";
import {
  additionalMedicareThreshold,
  isPublicCalculatorTaxYear,
  PUBLIC_CALCULATOR_TAX_YEARS,
  PUBLIC_FILING_STATUSES,
  socialSecurityWageBase,
  type PublicCalculatorTaxYear,
} from "@/lib/tax-rules/public-calculators";

const FILING_STATUSES = PUBLIC_FILING_STATUSES;
const DEFAULT_TAX_YEAR: PublicCalculatorTaxYear = 2026;

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(value);
}

function formatWhole(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

export function SETaxCalculatorClient() {
  const [taxYear, setTaxYear] = useState<PublicCalculatorTaxYear>(DEFAULT_TAX_YEAR);
  const [netProfit, setNetProfit] = useState("");
  const [filingStatus, setFilingStatus] = useState("single");
  const [w2SocialSecurityWages, setW2SocialSecurityWages] = useState("");
  const [w2MedicareWages, setW2MedicareWages] = useState("");

  const parsedProfit = Number(netProfit.replace(/[,$\s]/g, ""));
  const parsedW2SocialSecurity = Number(w2SocialSecurityWages.replace(/[,$\s]/g, ""));
  const parsedW2Medicare = Number(w2MedicareWages.replace(/[,$\s]/g, ""));
  const wageBase = socialSecurityWageBase(taxYear);
  const medicareThreshold = additionalMedicareThreshold(filingStatus);

  const outcome = useMemo(() => {
    try {
      if (![parsedProfit, parsedW2SocialSecurity, parsedW2Medicare].every(value => Number.isFinite(value) && value >= 0)) throw new Error('Enter valid nonnegative profit and wages.');
      if (parsedProfit === 0) return { value: null, error: null };
      const hasW2 = w2SocialSecurityWages.trim() !== '' || w2MedicareWages.trim() !== '';
      if (hasW2 && (w2SocialSecurityWages.trim() === '' || w2MedicareWages.trim() === '')) {
        throw new Error('Enter both W-2 Box 3 and Box 5, including explicit zero.');
      }
      assertWageOwnershipScope(filingStatus, parsedProfit, 0, {
        socialSecurityWages: parsedW2SocialSecurity,
        medicareWages: parsedW2Medicare,
      });
      return { value: calcScheduleSE({ scheduleCNetProfit: parsedProfit, taxYear }, filingStatus, parsedW2SocialSecurity, parsedW2Medicare), error: null };
    } catch (error) {
      return { value: null, error: error instanceof Error ? error.message : 'This calculation requires review.' };
    }
  }, [parsedProfit, filingStatus, parsedW2SocialSecurity, parsedW2Medicare, taxYear, w2SocialSecurityWages, w2MedicareWages]);
  const calculation = outcome.value;

  const handleYearChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const next = Number(event.target.value);
    if (isPublicCalculatorTaxYear(next)) setTaxYear(next);
  };

  return (
    <div className="min-h-screen bg-background">
      <LandingHeader />

      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Hero */}
        <div className="mb-5">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-green-50 text-green-700 text-sm font-medium mb-4">
            <Calculator className="w-4 h-4" />
            Free Tool
          </div>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-gray-900 mb-3">
            Self-Employment Tax Calculator
          </h1>
          <p className="text-sm text-muted-foreground max-w-2xl leading-relaxed">
            Estimate your {taxYear} self-employment tax in seconds. See how Social Security and
            Medicare taxes are figured for a freelancer or 1099 contractor.
          </p>
        </div>

        <div className="grid items-start gap-4 lg:grid-cols-2">
          {/* Input Form */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <DollarSign className="w-5 h-5 text-green-600" />
                Your Information
              </CardTitle>
              <CardDescription>
                Enter your Schedule C net profit to calculate SE tax
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 [&_input]:min-h-11 [&_select]:min-h-11">
              <div>
                <label htmlFor="tax-year" className="block text-sm font-medium text-gray-700 mb-1.5">
                  Tax Year
                </label>
                <select
                  id="tax-year"
                  value={taxYear}
                  onChange={handleYearChange}
                  className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900 bg-white"
                >
                  {PUBLIC_CALCULATOR_TAX_YEARS.map((year) => (
                    <option key={year} value={year}>{year}</option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-gray-500">
                  Social Security wage base: {formatWhole(wageBase)} for {taxYear}. The 2027 wage base has not been announced.
                </p>
              </div>

              <div>
                <label htmlFor="net-profit" className="block text-sm font-medium text-gray-700 mb-1.5">
                  Schedule C Net Profit
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">$</span>
                  <input
                    id="net-profit"
                    type="text"
                    inputMode="decimal"
                    placeholder="e.g. 75,000"
                    value={netProfit}
                    onChange={(e) => setNetProfit(e.target.value)}
                    className="w-full pl-7 pr-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
                  />
                </div>
                <p className="mt-1 text-xs text-gray-500">
                  Your net profit from self-employment (Schedule C, Line 31)
                </p>
              </div>

              <div>
                <label htmlFor="filing-status" className="block text-sm font-medium text-gray-700 mb-1.5">
                  Filing Status
                </label>
                <select
                  id="filing-status"
                  value={filingStatus}
                  onChange={(e) => setFilingStatus(e.target.value)}
                  className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900 bg-white"
                >
                  {FILING_STATUSES.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="w2-wages" className="block text-sm font-medium text-gray-700 mb-1.5">
                  W-2 Box 3 - Social Security Wages (optional)
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">$</span>
                  <input
                    id="w2-wages"
                    type="text"
                    inputMode="decimal"
                    placeholder="0"
                    value={w2SocialSecurityWages}
                    onChange={(e) => setW2SocialSecurityWages(e.target.value)}
                    className="w-full pl-7 pr-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
                  />
                </div>
                <p className="mt-1 text-xs text-gray-500">
                  Box 3 uses part of the Social Security wage base. Enter zero when the printed box is zero.
                </p>
              </div>
              <div>
                <label htmlFor="w2-medicare-wages" className="block text-sm font-medium text-gray-700 mb-1.5">
                  W-2 Box 5 - Medicare Wages (required with Box 3)
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">$</span>
                  <input id="w2-medicare-wages" type="text" inputMode="decimal" placeholder="0"
                    value={w2MedicareWages} onChange={(event) => setW2MedicareWages(event.target.value)}
                    className="w-full pl-7 pr-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900" />
                </div>
                <p className="mt-1 text-xs text-gray-500">
                  Box 5 coordinates Additional Medicare tax. Enter zero when the printed box is zero.
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Results */}
          <div className="space-y-6">
            {outcome.error ? <Card><CardContent className="pt-6"><p role="alert" className="text-sm text-destructive">{outcome.error}</p></CardContent></Card> : calculation ? (
              <>
                {/* Total SE Tax */}
                <Card className="border-green-200 bg-green-50/50">
                  <CardContent className="pt-6">
                    <div className="text-center">
                      <p className="text-sm font-medium text-green-700 mb-1">Total Self-Employment Tax</p>
                      <p className="text-3xl font-semibold text-green-800">
                        {formatCurrency(calculation.totalSETax)}
                      </p>
                      <p className="text-sm text-green-600 mt-2">
                        Deductible half: {formatCurrency(calculation.halfSEDeduction)}
                      </p>
                    </div>
                  </CardContent>
                </Card>

                {/* Breakdown */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Tax Breakdown</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex justify-between items-center py-2 border-b border-gray-100">
                      <div>
                        <p className="text-sm font-medium text-gray-900">Net Earnings</p>
                        <p className="text-xs text-gray-500">Schedule C net profit</p>
                      </div>
                      <p className="text-sm font-semibold">{formatCurrency(calculation.netEarnings)}</p>
                    </div>
                    <div className="flex justify-between items-center py-2 border-b border-gray-100">
                      <div>
                        <p className="text-sm font-medium text-gray-900">SE Tax Base (92.35%)</p>
                        <p className="text-xs text-gray-500">Net earnings x 0.9235</p>
                      </div>
                      <p className="text-sm font-semibold">{formatCurrency(calculation.seBase)}</p>
                    </div>
                    <div className="flex justify-between items-center py-2 border-b border-gray-100">
                      <div>
                        <p className="text-sm font-medium text-gray-900">Social Security (12.4%)</p>
                        <p className="text-xs text-gray-500">Up to the {formatWhole(wageBase)} {taxYear} wage base</p>
                      </div>
                      <p className="text-sm font-semibold">{formatCurrency(calculation.socialSecurityTax)}</p>
                    </div>
                    <div className="flex justify-between items-center py-2 border-b border-gray-100">
                      <div>
                        <p className="text-sm font-medium text-gray-900">Medicare (2.9%)</p>
                        <p className="text-xs text-gray-500">On all SE earnings</p>
                      </div>
                      <p className="text-sm font-semibold">{formatCurrency(calculation.medicareTax)}</p>
                    </div>
                    {calculation.additionalMedicareTax > 0 && (
                      <div className="flex justify-between items-center py-2 border-b border-gray-100">
                        <div>
                          <p className="text-sm font-medium text-gray-900">Additional Medicare (0.9%)</p>
                          <p className="text-xs text-gray-500">
                            Form 8959: on combined wages and SE earnings over {formatWhole(medicareThreshold)}
                          </p>
                        </div>
                        <p className="text-sm font-semibold">{formatCurrency(calculation.additionalMedicareTax)}</p>
                      </div>
                    )}
                    <div className="flex justify-between items-center py-2 bg-gray-50 -mx-6 px-6 rounded-lg">
                      <div>
                        <p className="text-sm font-bold text-gray-900">Half SE Tax Deduction</p>
                        <p className="text-xs text-gray-500">Deductible on Schedule 1, Line 15</p>
                      </div>
                      <p className="text-sm font-bold text-green-700">-{formatCurrency(calculation.halfSEDeduction)}</p>
                    </div>
                  </CardContent>
                </Card>
              </>
            ) : (
              <Card>
                <CardContent className="pt-6">
                  <div className="text-center py-4 text-gray-500">
                    <Calculator className="w-10 h-10 mx-auto mb-3 opacity-40" />
                    <p className="font-medium">Enter your net profit to see results</p>
                    <p className="text-sm mt-1">
                      {parsedProfit > 0 && parsedProfit * 0.9235 < 400
                        ? "No SE tax is owed when net earnings are under $400."
                        : "Your self-employment tax breakdown will appear here."}
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>

        {/* Educational Content for SEO */}
        <div className="mt-5 space-y-3">
          <details className="rounded-xl border border-border bg-card">
            <summary className="min-h-11 cursor-pointer px-4 py-3 text-base font-semibold text-foreground">What Is Self-Employment Tax?</summary>
            <div className="border-t border-border p-4 text-sm">
            <p className="text-gray-600 leading-relaxed mb-3">
              Self-employment tax is the Social Security and Medicare tax that self-employed
              individuals pay. When you work as an employee, your employer pays half of these
              taxes. But when you&apos;re self-employed, you pay both halves  - a combined rate
              of 15.3% on your net earnings.
            </p>
            <p className="text-gray-600 leading-relaxed">
              The good news: you can deduct half of your self-employment tax when calculating
              your adjusted gross income (AGI), which reduces your overall income tax.
            </p>

            </div>
          </details>

          <details className="rounded-xl border border-border bg-card">
            <summary className="min-h-11 cursor-pointer px-4 py-3 text-base font-semibold text-foreground">{taxYear} Self-Employment Tax Rates</summary>
            <div className="border-t border-border p-4 text-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-sm border border-gray-200 rounded-lg overflow-hidden">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left py-3 px-4 font-semibold text-gray-900">Tax Component</th>
                    <th className="text-left py-3 px-4 font-semibold text-gray-900">Rate</th>
                    <th className="text-left py-3 px-4 font-semibold text-gray-900">Applies To</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  <tr>
                    <td className="py-3 px-4 text-gray-700">Social Security</td>
                    <td className="py-3 px-4 text-gray-700">12.4%</td>
                    <td className="py-3 px-4 text-gray-700">First {formatWhole(wageBase)} of combined W-2 wages and net earnings ({taxYear} wage base)</td>
                  </tr>
                  <tr>
                    <td className="py-3 px-4 text-gray-700">Medicare</td>
                    <td className="py-3 px-4 text-gray-700">2.9%</td>
                    <td className="py-3 px-4 text-gray-700">All net earnings</td>
                  </tr>
                  <tr>
                    <td className="py-3 px-4 text-gray-700">Additional Medicare</td>
                    <td className="py-3 px-4 text-gray-700">0.9%</td>
                    <td className="py-3 px-4 text-gray-700">Wages plus net earnings over $200,000 ($250,000 married filing jointly; $125,000 married filing separately)</td>
                  </tr>
                  <tr className="bg-gray-50">
                    <td className="py-3 px-4 font-semibold text-gray-900">SE Adjustment</td>
                    <td className="py-3 px-4 font-semibold text-gray-900">92.35%</td>
                    <td className="py-3 px-4 text-gray-700">Applied to net profit before tax calculation</td>
                  </tr>
                </tbody>
              </table>
            </div>

            </div>
          </details>

          <details className="rounded-xl border border-border bg-card">
            <summary className="min-h-11 cursor-pointer px-4 py-3 text-base font-semibold text-foreground">How to Calculate Self-Employment Tax</summary>
            <div className="border-t border-border p-4 text-sm">
            <ol className="list-decimal list-inside space-y-3 text-gray-600">
              <li>
                <strong>Determine your net profit</strong>  - This is your Schedule C, Line 31
                (gross income minus business expenses).
              </li>
              <li>
                <strong>Multiply by 92.35%</strong>  - The IRS only taxes 92.35% of your net
                earnings (this accounts for the employer-equivalent portion).
              </li>
              <li>
                <strong>Calculate Social Security tax</strong>  - 12.4% on the first {formatWhole(wageBase)}
                ({taxYear} wage base). If you have W-2 income, subtract those Social Security wages first.
              </li>
              <li>
                <strong>Calculate Medicare tax</strong>  - 2.9% on all net earnings, plus an
                additional 0.9% on combined wages and net earnings over $200,000 (single or head of household),
                $250,000 (married filing jointly) or $125,000 (married filing separately).
              </li>
              <li>
                <strong>Deduct half</strong>  - Half of your total SE tax is deductible on
                Schedule 1, Line 15, reducing your adjusted gross income.
              </li>
            </ol>

            </div>
          </details>

          {/* CTA */}
          <Card className="bg-slate-900 text-white border border-slate-800">
            <CardContent className="py-4">
              <div className="space-y-3">
                <h3 className="text-xl font-bold">Want to Find More Tax Deductions?</h3>
                <p className="text-slate-300 max-w-2xl text-sm leading-relaxed">
                  WriteOff tracks your business expenses, suggests likely deductions for your
                  review, and keeps the records your preparer needs at tax time.
                </p>
                <Link href="/auth/sign-up">
                  <Button size="lg" className="bg-white text-green-700 hover:bg-green-50 mt-2">
                    Start Free Trial
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>

          {/* Info box */}
          <div className="flex items-start gap-3 p-4 bg-blue-50 rounded-lg border border-blue-200">
            <Info className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
            <div className="text-sm text-blue-800">
              <p className="font-medium mb-1">Planning estimate, not tax advice</p>
              <p>
                This calculator is a planning estimate using the Schedule SE formula (92.35% of net profit; 12.4%
                Social Security up to the {formatWhole(wageBase)} {taxYear} wage base; 2.9% Medicare) and the 0.9%
                Additional Medicare Tax thresholds. It does not cover church employee income, farm optional methods,
                spouses with separate businesses, or income tax. Verify the rules in the{" "}
                <a href="https://www.irs.gov/instructions/i1040sse" className="underline" target="_blank" rel="noopener noreferrer">IRS Schedule SE instructions</a>{" "}
                and consult a qualified tax professional for your specific situation.
              </p>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-border mt-6">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex flex-wrap items-center justify-between gap-4 text-sm text-gray-500">
            <p>&copy; {new Date().getFullYear()} WriteOff. All rights reserved.</p>
            <div className="flex gap-4">
              <Link href="/about" className="hover:text-gray-700">About</Link>
              <Link href="/blog" className="hover:text-gray-700">Blog</Link>
              <Link href="/privacy" className="hover:text-gray-700">Privacy</Link>
              <Link href="/contact" className="hover:text-gray-700">Contact</Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
