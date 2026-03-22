"use client";

import React, { useState, useMemo } from "react";
import Link from "next/link";
import { LandingHeader } from "@/components/landing/landing-header";
import Image from "next/image";
import { Calculator, DollarSign, Info, ArrowRight, TrendingDown, Percent, PiggyBank } from "lucide-react";
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

function fmt(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

function fmtPct(value: number): string {
  return value.toFixed(1) + "%";
}

// Simplified 1040 for the public calculator
function calculate1099Tax(netProfit: number, filingStatus: string, w2Wages: number, expenses: number) {
  const adjustedProfit = Math.max(0, netProfit - expenses);

  // SE tax
  const se = calcScheduleSE(
    { scheduleCNetProfit: adjustedProfit, taxYear: 2025 },
    filingStatus === "married_filing_jointly" ? "married" : "single",
    w2Wages
  );

  // QBI deduction (simplified  - 20% of net profit for income under threshold)
  const standardDeduction = STANDARD_DEDUCTIONS_2025[filingStatus as keyof typeof STANDARD_DEDUCTIONS_2025] ?? 15750;
  const totalIncome = adjustedProfit + w2Wages;
  const agi = Math.max(0, totalIncome - se.halfSEDeduction);
  const taxableBeforeQBI = Math.max(0, agi - standardDeduction);

  // QBI: 20% of qualified business income, capped at 20% of taxable income
  const qbiThreshold = filingStatus === "married_filing_jointly" ? 394600 : 197300;
  let qbiDeduction = 0;
  if (adjustedProfit > 0 && taxableBeforeQBI <= qbiThreshold) {
    const qualifiedBI = Math.max(0, adjustedProfit - se.halfSEDeduction);
    qbiDeduction = Math.min(qualifiedBI * 0.20, taxableBeforeQBI * 0.20);
  }

  const taxableIncome = Math.max(0, taxableBeforeQBI - qbiDeduction);
  const incomeTax = calculateFederalIncomeTax(taxableIncome, filingStatus);

  const totalTax = incomeTax + se.totalSETax;
  const effectiveRate = totalIncome > 0 ? (totalTax / totalIncome) * 100 : 0;
  const quarterlyPayment = totalTax / 4;

  return {
    adjustedProfit,
    totalIncome,
    agi,
    standardDeduction,
    qbiDeduction,
    taxableIncome,
    incomeTax,
    seTax: se.totalSETax,
    halfSEDeduction: se.halfSEDeduction,
    totalTax,
    effectiveRate,
    quarterlyPayment,
    seBreakdown: se,
  };
}

export function TaxCalculator1099Client() {
  const [netProfit, setNetProfit] = useState("");
  const [filingStatus, setFilingStatus] = useState("single");
  const [w2Wages, setW2Wages] = useState("");
  const [expenses, setExpenses] = useState("");

  const parsedProfit = parseFloat(netProfit.replace(/[,$]/g, "")) || 0;
  const parsedW2 = parseFloat(w2Wages.replace(/[,$]/g, "")) || 0;
  const parsedExpenses = parseFloat(expenses.replace(/[,$]/g, "")) || 0;

  const calc = useMemo(() => {
    if (parsedProfit <= 0) return null;
    return calculate1099Tax(parsedProfit, filingStatus, parsedW2, parsedExpenses);
  }, [parsedProfit, filingStatus, parsedW2, parsedExpenses]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white">
      <LandingHeader />

      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        {/* Hero */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-green-50 text-green-700 text-sm font-medium mb-4">
            <Calculator className="w-4 h-4" />
            Free Tool
          </div>
          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-gray-900 mb-3">
            1099 Tax Calculator
          </h1>
          <p className="text-lg text-gray-600 max-w-2xl mx-auto">
            Estimate your total 2025 federal tax bill as a freelancer or 1099 contractor.
            See income tax, self-employment tax, QBI deduction, and your effective rate.
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
                Enter your 1099 income and expenses
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div>
                <label htmlFor="gross-income" className="block text-sm font-medium text-gray-700 mb-1.5">
                  Gross 1099 Income
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">$</span>
                  <input
                    id="gross-income"
                    type="text"
                    inputMode="decimal"
                    placeholder="e.g. 100,000"
                    value={netProfit}
                    onChange={(e) => setNetProfit(e.target.value)}
                    className="w-full pl-7 pr-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
                  />
                </div>
                <p className="mt-1 text-xs text-gray-500">Total income reported on your 1099 forms</p>
              </div>

              <div>
                <label htmlFor="expenses" className="block text-sm font-medium text-gray-700 mb-1.5">
                  Business Expenses
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">$</span>
                  <input
                    id="expenses"
                    type="text"
                    inputMode="decimal"
                    placeholder="e.g. 15,000"
                    value={expenses}
                    onChange={(e) => setExpenses(e.target.value)}
                    className="w-full pl-7 pr-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
                  />
                </div>
                <p className="mt-1 text-xs text-gray-500">Deductible business expenses (Schedule C deductions)</p>
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
                <p className="mt-1 text-xs text-gray-500">If you also have a W-2 job, enter those wages</p>
              </div>
            </CardContent>
          </Card>

          {/* Results */}
          <div className="space-y-6">
            {calc ? (
              <>
                {/* Total Tax */}
                <Card className="border-green-200 bg-green-50/50">
                  <CardContent className="pt-6">
                    <div className="text-center">
                      <p className="text-sm font-medium text-green-700 mb-1">Estimated Total Federal Tax</p>
                      <p className="text-4xl font-extrabold text-green-800">{fmt(calc.totalTax)}</p>
                      <p className="text-sm text-green-600 mt-2">
                        Effective rate: {fmtPct(calc.effectiveRate)}
                      </p>
                    </div>
                  </CardContent>
                </Card>

                {/* Key metrics */}
                <div className="grid grid-cols-2 gap-3">
                  <Card>
                    <CardContent className="pt-4 pb-4 text-center">
                      <Percent className="w-5 h-5 text-blue-600 mx-auto mb-1" />
                      <p className="text-xs text-gray-500">Income Tax</p>
                      <p className="text-lg font-bold text-gray-900">{fmt(calc.incomeTax)}</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-4 pb-4 text-center">
                      <PiggyBank className="w-5 h-5 text-violet-600 mx-auto mb-1" />
                      <p className="text-xs text-gray-500">SE Tax</p>
                      <p className="text-lg font-bold text-gray-900">{fmt(calc.seTax)}</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-4 pb-4 text-center">
                      <TrendingDown className="w-5 h-5 text-emerald-600 mx-auto mb-1" />
                      <p className="text-xs text-gray-500">QBI Deduction</p>
                      <p className="text-lg font-bold text-emerald-700">-{fmt(calc.qbiDeduction)}</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-4 pb-4 text-center">
                      <Calculator className="w-5 h-5 text-amber-600 mx-auto mb-1" />
                      <p className="text-xs text-gray-500">Quarterly Payment</p>
                      <p className="text-lg font-bold text-gray-900">{fmt(calc.quarterlyPayment)}</p>
                    </CardContent>
                  </Card>
                </div>

                {/* Full Breakdown */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Tax Breakdown</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <Row label="Gross 1099 Income" value={fmt(parsedProfit)} />
                    {parsedExpenses > 0 && (
                      <Row label="Business Expenses" value={`-${fmt(parsedExpenses)}`} sub="Schedule C deductions" green />
                    )}
                    <Row label="Net Self-Employment Profit" value={fmt(calc.adjustedProfit)} sub="Schedule C, Line 31" bold />
                    {parsedW2 > 0 && <Row label="W-2 Wages" value={fmt(parsedW2)} />}
                    <Row label="Total Income" value={fmt(calc.totalIncome)} />
                    <div className="border-t border-gray-200 my-2" />
                    <Row label="Half SE Tax Deduction" value={`-${fmt(calc.halfSEDeduction)}`} sub="Schedule 1, Line 15" green />
                    <Row label="Adjusted Gross Income" value={fmt(calc.agi)} bold />
                    <Row label="Standard Deduction" value={`-${fmt(calc.standardDeduction)}`} green />
                    {calc.qbiDeduction > 0 && (
                      <Row label="QBI Deduction (20%)" value={`-${fmt(calc.qbiDeduction)}`} sub="Section 199A" green />
                    )}
                    <Row label="Taxable Income" value={fmt(calc.taxableIncome)} bold />
                    <div className="border-t border-gray-200 my-2" />
                    <Row label="Federal Income Tax" value={fmt(calc.incomeTax)} />
                    <Row label="Self-Employment Tax" value={fmt(calc.seTax)} sub="Social Security + Medicare" />
                    <div className="flex justify-between items-center py-2 bg-gray-50 -mx-6 px-6 rounded-lg">
                      <p className="text-sm font-bold text-gray-900">Total Federal Tax</p>
                      <p className="text-sm font-bold text-gray-900">{fmt(calc.totalTax)}</p>
                    </div>
                  </CardContent>
                </Card>
              </>
            ) : (
              <Card>
                <CardContent className="pt-6">
                  <div className="text-center py-8 text-gray-500">
                    <Calculator className="w-10 h-10 mx-auto mb-3 opacity-40" />
                    <p className="font-medium">Enter your 1099 income to see results</p>
                    <p className="text-sm mt-1">Your complete tax breakdown will appear here.</p>
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
              How 1099 Taxes Work for Freelancers
            </h2>
            <p className="text-gray-600 leading-relaxed mb-3">
              When you receive 1099 income, no taxes are withheld for you. Unlike W-2 employees whose employers
              withhold income tax, Social Security, and Medicare, freelancers are responsible for paying all of these
              taxes themselves  - typically through quarterly estimated payments.
            </p>
            <p className="text-gray-600 leading-relaxed">
              Your total tax bill as a 1099 contractor includes two main components: federal income tax (based on tax
              brackets) and self-employment tax (15.3% for Social Security and Medicare). The good news is that you can
              deduct business expenses, take the QBI deduction (up to 20% off your business income), and deduct half of
              your SE tax  - all of which significantly reduce your bill.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">
              What This Calculator Includes
            </h2>
            <div className="grid sm:grid-cols-2 gap-4">
              {[
                { title: "Federal Income Tax", desc: "2025 tax brackets applied to your taxable income after all deductions." },
                { title: "Self-Employment Tax", desc: "15.3% SE tax (Social Security 12.4% + Medicare 2.9%) on 92.35% of net profit." },
                { title: "QBI Deduction", desc: "Section 199A qualified business income deduction  - up to 20% off your business profit." },
                { title: "Standard Deduction", desc: "2025 standard deduction ($15,750 single, $31,500 MFJ) applied automatically." },
              ].map((item) => (
                <div key={item.title} className="rounded-lg border border-gray-200 p-4">
                  <h3 className="text-sm font-semibold text-gray-900 mb-1">{item.title}</h3>
                  <p className="text-sm text-gray-600">{item.desc}</p>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">
              2025 Quarterly Estimated Tax Due Dates
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border border-gray-200 rounded-lg overflow-hidden">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left py-3 px-4 font-semibold text-gray-900">Quarter</th>
                    <th className="text-left py-3 px-4 font-semibold text-gray-900">Income Period</th>
                    <th className="text-left py-3 px-4 font-semibold text-gray-900">Due Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  <tr><td className="py-3 px-4">Q1</td><td className="py-3 px-4">Jan 1 – Mar 31</td><td className="py-3 px-4 font-medium">April 15, 2025</td></tr>
                  <tr><td className="py-3 px-4">Q2</td><td className="py-3 px-4">Apr 1 – May 31</td><td className="py-3 px-4 font-medium">June 16, 2025</td></tr>
                  <tr><td className="py-3 px-4">Q3</td><td className="py-3 px-4">Jun 1 – Aug 31</td><td className="py-3 px-4 font-medium">September 15, 2025</td></tr>
                  <tr><td className="py-3 px-4">Q4</td><td className="py-3 px-4">Sep 1 – Dec 31</td><td className="py-3 px-4 font-medium">January 15, 2026</td></tr>
                </tbody>
              </table>
            </div>
          </section>

          {/* CTA */}
          <Card className="bg-gradient-to-r from-green-600 to-emerald-600 text-white border-0">
            <CardContent className="py-8">
              <div className="text-center space-y-4">
                <h3 className="text-xl font-bold">Want to Find Every Deduction You Qualify For?</h3>
                <p className="text-green-100 max-w-lg mx-auto">
                  WriteOff automatically tracks your expenses, categorizes them for Schedule C,
                  and finds deductions you might be missing  - reducing both income tax and SE tax.
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
                This calculator provides estimates based on 2025 IRS tax rates and brackets (Rev. Proc. 2024-40,
                updated by OBBB P.L. 119-21). It does not account for state taxes, credits (EITC, CTC), or
                itemized deductions. Consult a qualified tax professional for your specific situation.
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

function Row({ label, value, sub, bold, green }: { label: string; value: string; sub?: string; bold?: boolean; green?: boolean }) {
  return (
    <div className="flex justify-between items-center py-2 border-b border-gray-100">
      <div>
        <p className={`text-sm ${bold ? "font-bold" : "font-medium"} text-gray-900`}>{label}</p>
        {sub && <p className="text-xs text-gray-500">{sub}</p>}
      </div>
      <p className={`text-sm ${bold ? "font-bold" : "font-semibold"} ${green ? "text-green-700" : ""}`}>{value}</p>
    </div>
  );
}
