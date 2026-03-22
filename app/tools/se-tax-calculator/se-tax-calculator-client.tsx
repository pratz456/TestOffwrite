"use client";

import React, { useState, useMemo } from "react";
import Link from "next/link";
import Image from "next/image";
import { ArrowLeft, Calculator, DollarSign, Info, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { calcScheduleSE } from "@/lib/reports/calcSE";

const FILING_STATUSES = [
  { value: "single", label: "Single" },
  { value: "married", label: "Married Filing Jointly" },
  { value: "married_filing_separately", label: "Married Filing Separately" },
  { value: "head_of_household", label: "Head of Household" },
];

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(value);
}

export function SETaxCalculatorClient() {
  const [netProfit, setNetProfit] = useState("");
  const [filingStatus, setFilingStatus] = useState("single");
  const [w2Wages, setW2Wages] = useState("");

  const parsedProfit = parseFloat(netProfit.replace(/[,$]/g, "")) || 0;
  const parsedW2 = parseFloat(w2Wages.replace(/[,$]/g, "")) || 0;

  const calculation = useMemo(() => {
    if (parsedProfit <= 0) return null;
    return calcScheduleSE(
      { scheduleCNetProfit: parsedProfit, taxYear: 2025 },
      filingStatus,
      parsedW2
    );
  }, [parsedProfit, filingStatus, parsedW2]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white">
      {/* Header */}
      <header className="border-b border-gray-200 bg-white">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <Link href="/" className="flex items-center gap-2">
              <Image src="/writeofflogo.png" alt="WriteOff" width={28} height={28} className="rounded-md" />
              <span className="font-semibold text-gray-900">WriteOff</span>
            </Link>
            <Link href="/">
              <Button variant="outline" size="sm">
                <ArrowLeft className="w-4 h-4 mr-1.5" />
                Home
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        {/* Hero */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-green-50 text-green-700 text-sm font-medium mb-4">
            <Calculator className="w-4 h-4" />
            Free Tool
          </div>
          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-gray-900 mb-3">
            Self-Employment Tax Calculator
          </h1>
          <p className="text-lg text-gray-600 max-w-2xl mx-auto">
            Calculate your 2025 self-employment tax in seconds. See exactly how much you owe
            in Social Security and Medicare taxes as a freelancer or 1099 contractor.
          </p>
        </div>

        <div className="grid gap-8 lg:grid-cols-2">
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
            <CardContent className="space-y-5">
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
                  W-2 Social Security Wages (optional)
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
                <p className="mt-1 text-xs text-gray-500">
                  Box 3 of your W-2  - reduces your Social Security wage base
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Results */}
          <div className="space-y-6">
            {calculation && calculation.totalSETax > 0 ? (
              <>
                {/* Total SE Tax */}
                <Card className="border-green-200 bg-green-50/50">
                  <CardContent className="pt-6">
                    <div className="text-center">
                      <p className="text-sm font-medium text-green-700 mb-1">Total Self-Employment Tax</p>
                      <p className="text-4xl font-extrabold text-green-800">
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
                        <p className="text-xs text-gray-500">Up to ${(176100).toLocaleString()} wage base</p>
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
                            On earnings over ${filingStatus === "married" ? "250,000" : "200,000"}
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
                  <div className="text-center py-8 text-gray-500">
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
        <div className="mt-16 space-y-10">
          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">
              What Is Self-Employment Tax?
            </h2>
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
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">
              2025 Self-Employment Tax Rates
            </h2>
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
                    <td className="py-3 px-4 text-gray-700">First $176,100 of net earnings</td>
                  </tr>
                  <tr>
                    <td className="py-3 px-4 text-gray-700">Medicare</td>
                    <td className="py-3 px-4 text-gray-700">2.9%</td>
                    <td className="py-3 px-4 text-gray-700">All net earnings</td>
                  </tr>
                  <tr>
                    <td className="py-3 px-4 text-gray-700">Additional Medicare</td>
                    <td className="py-3 px-4 text-gray-700">0.9%</td>
                    <td className="py-3 px-4 text-gray-700">Earnings over $200,000 ($250,000 if married)</td>
                  </tr>
                  <tr className="bg-gray-50">
                    <td className="py-3 px-4 font-semibold text-gray-900">SE Adjustment</td>
                    <td className="py-3 px-4 font-semibold text-gray-900">92.35%</td>
                    <td className="py-3 px-4 text-gray-700">Applied to net profit before tax calculation</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">
              How to Calculate Self-Employment Tax
            </h2>
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
                <strong>Calculate Social Security tax</strong>  - 12.4% on the first $176,100
                (2025 wage base). If you have W-2 income, subtract those Social Security wages first.
              </li>
              <li>
                <strong>Calculate Medicare tax</strong>  - 2.9% on all net earnings, plus an
                additional 0.9% on earnings over $200,000 (single) or $250,000 (married).
              </li>
              <li>
                <strong>Deduct half</strong>  - Half of your total SE tax is deductible on
                Schedule 1, Line 15, reducing your adjusted gross income.
              </li>
            </ol>
          </section>

          {/* CTA */}
          <Card className="bg-gradient-to-r from-green-600 to-emerald-600 text-white border-0">
            <CardContent className="py-8">
              <div className="text-center space-y-4">
                <h3 className="text-xl font-bold">Want to Find More Tax Deductions?</h3>
                <p className="text-green-100 max-w-lg mx-auto">
                  WriteOff automatically tracks your expenses and identifies every deduction
                  you qualify for  - reducing both your income tax and self-employment tax.
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
              <p className="font-medium mb-1">Disclaimer</p>
              <p>
                This calculator provides estimates based on 2025 IRS tax rates (Rev. Proc. 2024-40).
                It is for informational purposes only and does not constitute tax advice. Consult a
                qualified tax professional for your specific situation.
              </p>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
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
