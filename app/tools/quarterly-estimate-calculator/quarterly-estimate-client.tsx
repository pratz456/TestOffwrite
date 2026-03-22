"use client";

import React, { useState, useMemo } from "react";
import Link from "next/link";
import Image from "next/image";
import { ArrowLeft, Calculator, DollarSign, Info, ArrowRight, CalendarDays, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { calcScheduleSE } from "@/lib/reports/calcSE";
import {
  calculateFederalIncomeTax,
  STANDARD_DEDUCTIONS_2025,
} from "@/lib/tax-rules/federal-brackets";

const FILING_STATUSES = [
  { value: "single", label: "Single" },
  { value: "married_filing_jointly", label: "Married Filing Jointly" },
  { value: "married_filing_separately", label: "Married Filing Separately" },
  { value: "head_of_household", label: "Head of Household" },
];

const QUARTERS = [
  { q: "Q1", period: "Jan 1 – Mar 31", due: "April 15, 2025" },
  { q: "Q2", period: "Apr 1 – May 31", due: "June 16, 2025" },
  { q: "Q3", period: "Jun 1 – Aug 31", due: "September 15, 2025" },
  { q: "Q4", period: "Sep 1 – Dec 31", due: "January 15, 2026" },
];

function fmt(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

function calculateQuarterly(annualIncome: number, annualExpenses: number, filingStatus: string, w2Wages: number, priorYearTax: number) {
  const netProfit = Math.max(0, annualIncome - annualExpenses);

  const se = calcScheduleSE(
    { scheduleCNetProfit: netProfit, taxYear: 2025 },
    filingStatus === "married_filing_jointly" ? "married" : "single",
    w2Wages
  );

  const standardDeduction = STANDARD_DEDUCTIONS_2025[filingStatus as keyof typeof STANDARD_DEDUCTIONS_2025] ?? 15750;
  const totalIncome = netProfit + w2Wages;
  const agi = Math.max(0, totalIncome - se.halfSEDeduction);
  const taxableBeforeQBI = Math.max(0, agi - standardDeduction);

  // Simplified QBI
  const qbiThreshold = filingStatus === "married_filing_jointly" ? 394600 : 197300;
  let qbiDeduction = 0;
  if (netProfit > 0 && taxableBeforeQBI <= qbiThreshold) {
    const qualifiedBI = Math.max(0, netProfit - se.halfSEDeduction);
    qbiDeduction = Math.min(qualifiedBI * 0.20, taxableBeforeQBI * 0.20);
  }

  const taxableIncome = Math.max(0, taxableBeforeQBI - qbiDeduction);
  const incomeTax = calculateFederalIncomeTax(taxableIncome, filingStatus);
  const totalTax = incomeTax + se.totalSETax;

  // Safe harbor: 100% of prior year tax (110% if AGI > $150k)
  const safeHarborMultiplier = agi > 150000 ? 1.10 : 1.00;
  const safeHarborAmount = priorYearTax > 0 ? priorYearTax * safeHarborMultiplier : totalTax;

  // Recommended quarterly = lower of current-year method or safe harbor / 4
  const currentYearQuarterly = totalTax / 4;
  const safeHarborQuarterly = safeHarborAmount / 4;
  const recommendedQuarterly = priorYearTax > 0
    ? Math.min(currentYearQuarterly, safeHarborQuarterly)
    : currentYearQuarterly;

  const annualPayment = recommendedQuarterly * 4;

  return {
    netProfit,
    totalTax,
    incomeTax,
    seTax: se.totalSETax,
    safeHarborAmount: priorYearTax > 0 ? safeHarborAmount : null,
    currentYearQuarterly,
    safeHarborQuarterly: priorYearTax > 0 ? safeHarborQuarterly : null,
    recommendedQuarterly,
    annualPayment,
  };
}

export function QuarterlyEstimateClient() {
  const [annualIncome, setAnnualIncome] = useState("");
  const [annualExpenses, setAnnualExpenses] = useState("");
  const [filingStatus, setFilingStatus] = useState("single");
  const [w2Wages, setW2Wages] = useState("");
  const [priorYearTax, setPriorYearTax] = useState("");

  const parsedIncome = parseFloat(annualIncome.replace(/[,$]/g, "")) || 0;
  const parsedExpenses = parseFloat(annualExpenses.replace(/[,$]/g, "")) || 0;
  const parsedW2 = parseFloat(w2Wages.replace(/[,$]/g, "")) || 0;
  const parsedPriorTax = parseFloat(priorYearTax.replace(/[,$]/g, "")) || 0;

  const calc = useMemo(() => {
    if (parsedIncome <= 0) return null;
    return calculateQuarterly(parsedIncome, parsedExpenses, filingStatus, parsedW2, parsedPriorTax);
  }, [parsedIncome, parsedExpenses, filingStatus, parsedW2, parsedPriorTax]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white">
      <header className="border-b border-gray-200 bg-white">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <Link href="/" className="flex items-center gap-2">
              <Image src="/writeofflogo.png" alt="WriteOff" width={28} height={28} className="rounded-md" />
              <span className="font-semibold text-gray-900">WriteOff</span>
            </Link>
            <div className="flex items-center gap-2">
              <Link href="/tools">
                <Button variant="outline" size="sm">
                  <ArrowLeft className="w-4 h-4 mr-1.5" />
                  All Tools
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-green-50 text-green-700 text-sm font-medium mb-4">
            <Calculator className="w-4 h-4" />
            Free Tool
          </div>
          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-gray-900 mb-3">
            Quarterly Estimated Tax Calculator
          </h1>
          <p className="text-lg text-gray-600 max-w-2xl mx-auto">
            Calculate how much to pay each quarter in 2025 to avoid IRS underpayment penalties.
            Uses both the current-year and safe harbor methods.
          </p>
        </div>

        <div className="grid gap-8 lg:grid-cols-2">
          {/* Input */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <DollarSign className="w-5 h-5 text-green-600" />
                Projected Annual Income
              </CardTitle>
              <CardDescription>
                Enter your expected 2025 income and expenses
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div>
                <label htmlFor="annual-income" className="block text-sm font-medium text-gray-700 mb-1.5">
                  Expected 1099 / Self-Employment Income
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">$</span>
                  <input
                    id="annual-income"
                    type="text"
                    inputMode="decimal"
                    placeholder="e.g. 100,000"
                    value={annualIncome}
                    onChange={(e) => setAnnualIncome(e.target.value)}
                    className="w-full pl-7 pr-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="annual-expenses" className="block text-sm font-medium text-gray-700 mb-1.5">
                  Expected Business Expenses
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">$</span>
                  <input
                    id="annual-expenses"
                    type="text"
                    inputMode="decimal"
                    placeholder="e.g. 20,000"
                    value={annualExpenses}
                    onChange={(e) => setAnnualExpenses(e.target.value)}
                    className="w-full pl-7 pr-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
                  />
                </div>
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
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="w2-wages" className="block text-sm font-medium text-gray-700 mb-1.5">
                  W-2 Wages (optional)
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">$</span>
                  <input
                    id="w2-wages"
                    type="text"
                    inputMode="decimal"
                    placeholder="0"
                    value={w2Wages}
                    onChange={(e) => setW2Wages(e.target.value)}
                    className="w-full pl-7 pr-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
                  />
                </div>
                <p className="mt-1 text-xs text-gray-500">W-2 withholding counts toward your tax payments</p>
              </div>

              <div>
                <label htmlFor="prior-year-tax" className="block text-sm font-medium text-gray-700 mb-1.5">
                  Prior Year Total Tax (optional)
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">$</span>
                  <input
                    id="prior-year-tax"
                    type="text"
                    inputMode="decimal"
                    placeholder="e.g. 12,000"
                    value={priorYearTax}
                    onChange={(e) => setPriorYearTax(e.target.value)}
                    className="w-full pl-7 pr-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
                  />
                </div>
                <p className="mt-1 text-xs text-gray-500">
                  From your 2024 Form 1040, Line 24. Enables safe harbor calculation.
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Results */}
          <div className="space-y-6">
            {calc ? (
              <>
                {/* Recommended Payment */}
                <Card className="border-green-200 bg-green-50/50">
                  <CardContent className="pt-6">
                    <div className="text-center">
                      <p className="text-sm font-medium text-green-700 mb-1">Recommended Quarterly Payment</p>
                      <p className="text-4xl font-extrabold text-green-800">{fmt(calc.recommendedQuarterly)}</p>
                      <p className="text-sm text-green-600 mt-2">
                        {fmt(calc.annualPayment)} per year ({fmt(calc.totalTax)} total estimated tax)
                      </p>
                    </div>
                  </CardContent>
                </Card>

                {/* Quarterly Schedule */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <CalendarDays className="w-4 h-4 text-blue-600" />
                      2025 Payment Schedule
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {QUARTERS.map((q) => (
                        <div key={q.q} className="flex items-center justify-between py-2.5 border-b border-gray-100 last:border-0">
                          <div>
                            <p className="text-sm font-semibold text-gray-900">{q.q}: {q.period}</p>
                            <p className="text-xs text-gray-500">Due {q.due}</p>
                          </div>
                          <p className="text-sm font-bold text-gray-900">{fmt(calc.recommendedQuarterly)}</p>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                {/* Methods comparison */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">How We Calculated This</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex justify-between items-center py-2 border-b border-gray-100">
                      <div>
                        <p className="text-sm font-medium text-gray-900">Current-Year Method</p>
                        <p className="text-xs text-gray-500">90% of 2025 estimated tax / 4</p>
                      </div>
                      <p className="text-sm font-semibold">{fmt(calc.currentYearQuarterly)}/qtr</p>
                    </div>
                    {calc.safeHarborQuarterly !== null && (
                      <div className="flex justify-between items-center py-2 border-b border-gray-100">
                        <div>
                          <p className="text-sm font-medium text-gray-900">Safe Harbor Method</p>
                          <p className="text-xs text-gray-500">
                            {calc.safeHarborAmount !== null && calc.safeHarborAmount > parsedPriorTax * 1.05
                              ? "110% of prior year tax / 4 (AGI > $150k)"
                              : "100% of prior year tax / 4"}
                          </p>
                        </div>
                        <p className="text-sm font-semibold">{fmt(calc.safeHarborQuarterly)}/qtr</p>
                      </div>
                    )}
                    <div className="flex justify-between items-center py-2 border-b border-gray-100">
                      <div>
                        <p className="text-sm font-medium text-gray-900">Federal Income Tax</p>
                      </div>
                      <p className="text-sm font-semibold">{fmt(calc.incomeTax)}</p>
                    </div>
                    <div className="flex justify-between items-center py-2 border-b border-gray-100">
                      <div>
                        <p className="text-sm font-medium text-gray-900">Self-Employment Tax</p>
                      </div>
                      <p className="text-sm font-semibold">{fmt(calc.seTax)}</p>
                    </div>
                    <div className="flex justify-between items-center py-2 bg-gray-50 -mx-6 px-6 rounded-lg">
                      <p className="text-sm font-bold text-gray-900">Total Estimated Annual Tax</p>
                      <p className="text-sm font-bold text-gray-900">{fmt(calc.totalTax)}</p>
                    </div>
                  </CardContent>
                </Card>

                {/* Penalty warning */}
                <div className="flex items-start gap-3 p-4 bg-amber-50 rounded-lg border border-amber-200">
                  <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" />
                  <div className="text-sm text-amber-800">
                    <p className="font-medium mb-1">Avoid the Underpayment Penalty</p>
                    <p>
                      The IRS charges a penalty if you don&apos;t pay at least 90% of your current year tax or
                      100% of your prior year tax (110% if AGI &gt; $150k) through withholding and estimated payments.
                    </p>
                  </div>
                </div>
              </>
            ) : (
              <Card>
                <CardContent className="pt-6">
                  <div className="text-center py-8 text-gray-500">
                    <Calculator className="w-10 h-10 mx-auto mb-3 opacity-40" />
                    <p className="font-medium">Enter your projected income to see results</p>
                    <p className="text-sm mt-1">Your quarterly payment schedule will appear here.</p>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>

        {/* Educational Content */}
        <div className="mt-16 space-y-10">
          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">
              What Are Quarterly Estimated Taxes?
            </h2>
            <p className="text-gray-600 leading-relaxed mb-3">
              Quarterly estimated taxes are how self-employed workers pay their income tax and self-employment tax
              throughout the year. Since no employer withholds taxes from your 1099 income, the IRS expects you to
              make payments four times a year using Form 1040-ES.
            </p>
            <p className="text-gray-600 leading-relaxed">
              You generally need to make estimated payments if you expect to owe $1,000 or more in tax when you file
              your return. Missing these payments (or underpaying) can result in an underpayment penalty calculated
              using the federal short-term interest rate plus 3%.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">
              Two Ways to Avoid the Penalty
            </h2>
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="rounded-lg border border-gray-200 p-5">
                <h3 className="text-sm font-semibold text-gray-900 mb-2">Current-Year Method</h3>
                <p className="text-sm text-gray-600">
                  Pay at least 90% of your current year&apos;s total tax liability through quarterly payments and withholding.
                  Best if your income is lower this year than last year.
                </p>
              </div>
              <div className="rounded-lg border border-gray-200 p-5">
                <h3 className="text-sm font-semibold text-gray-900 mb-2">Safe Harbor Method</h3>
                <p className="text-sm text-gray-600">
                  Pay 100% of last year&apos;s total tax (110% if your AGI exceeded $150,000). This guarantees no penalty
                  regardless of how much you earn this year.
                </p>
              </div>
            </div>
          </section>

          {/* CTA */}
          <Card className="bg-gradient-to-r from-green-600 to-emerald-600 text-white border-0">
            <CardContent className="py-8">
              <div className="text-center space-y-4">
                <h3 className="text-xl font-bold">Let WriteOff Calculate Your Quarterlies Automatically</h3>
                <p className="text-green-100 max-w-lg mx-auto">
                  WriteOff connects to your bank, tracks your income and expenses in real time, and tells you
                  exactly how much to pay each quarter — updated as your income changes.
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

          <div className="flex items-start gap-3 p-4 bg-blue-50 rounded-lg border border-blue-200">
            <Info className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
            <div className="text-sm text-blue-800">
              <p className="font-medium mb-1">Disclaimer</p>
              <p>
                This calculator provides estimates based on 2025 IRS tax rates (Rev. Proc. 2024-40, OBBB P.L. 119-21).
                It does not account for state taxes, credits, or annualized income installment method. Consult a
                qualified tax professional for your specific situation.
              </p>
            </div>
          </div>
        </div>
      </main>

      <footer className="border-t border-gray-200 mt-16">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
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
