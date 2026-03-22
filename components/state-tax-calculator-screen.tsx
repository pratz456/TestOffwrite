"use client";

import React, { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Calculator,
  DollarSign,
  MapPin,
  TrendingUp,
  PartyPopper,
} from "lucide-react";
import {
  US_STATES,
  STATE_TAX_CONFIG,
  calculateStateTax,
  type FilingStatus,
} from "@/lib/tax/state-tax-data";
import { calculateFederalIncomeTax } from "@/lib/tax-rules/federal-brackets";

interface StateTaxCalculatorScreenProps {
  user: { id: string; email?: string };
  userProfile?: any;
  onBack: () => void;
}

const STANDARD_DEDUCTIONS_2024: Record<string, number> = {
  single: 14600,
  married_filing_jointly: 29200,
  married_filing_separately: 14600,
  head_of_household: 21900,
};

const FILING_STATUS_OPTIONS: { value: FilingStatus; label: string }[] = [
  { value: "single", label: "Single" },
  { value: "married_filing_jointly", label: "Married Filing Jointly" },
  { value: "married_filing_separately", label: "Married Filing Separately" },
  { value: "head_of_household", label: "Head of Household" },
];

function parseIncome(value: string | number | undefined): number {
  if (value == null || value === "") return 0;
  if (typeof value === "number") return value;
  return parseFloat(String(value).replace(/[,$]/g, "")) || 0;
}

export function StateTaxCalculatorScreen({
  user,
  userProfile,
  onBack,
}: StateTaxCalculatorScreenProps) {
  const profileIncome = useMemo(() => {
    const inc = userProfile?.income ?? userProfile?.w2_income ?? userProfile?.business_income;
    return parseIncome(inc);
  }, [userProfile]);

  const profileState = userProfile?.state ?? "";

  const resolveStateCode = (stateVal: string): string => {
    if (!stateVal) return "";
    const byCode = US_STATES.find((s) => s.code === stateVal);
    if (byCode) return byCode.code;
    const byName = US_STATES.find(
      (s) => s.name.toLowerCase() === stateVal.toLowerCase()
    );
    return byName?.code ?? "";
  };

  const [stateCode, setStateCode] = useState<string>("");
  const [incomeStr, setIncomeStr] = useState<string>("");

  React.useEffect(() => {
    if (profileState) {
      const code = resolveStateCode(profileState);
      if (code) setStateCode((prev) => prev || code);
    }
  }, [profileState]);

  React.useEffect(() => {
    if (profileIncome > 0) {
      setIncomeStr((prev) => prev || String(Math.round(profileIncome)));
    }
  }, [profileIncome]);
  const normalizeFilingStatus = (s: string | undefined): FilingStatus => {
    if (!s) return "single";
    const lower = s.toLowerCase().replace(/\s+/g, "_");
    if (lower.includes("jointly")) return "married_filing_jointly";
    if (lower.includes("separately")) return "married_filing_separately";
    if (lower.includes("head") || lower.includes("household")) return "head_of_household";
    return "single";
  };

  const [filingStatus, setFilingStatus] = useState<FilingStatus>(
    normalizeFilingStatus(userProfile?.filing_status) || "single"
  );

  const income = parseIncome(incomeStr);
  const hasValidInput = stateCode && income > 0;

  const { stateTax, federalTax, effectiveStateRate, effectiveCombinedRate } =
    useMemo(() => {
      if (!hasValidInput) {
        return {
          stateTax: 0,
          federalTax: 0,
          effectiveStateRate: 0,
          effectiveCombinedRate: 0,
        };
      }

      const standardDeduction =
        STANDARD_DEDUCTIONS_2024[filingStatus] ?? STANDARD_DEDUCTIONS_2024.single;
      const taxableIncome = Math.max(0, income - standardDeduction);

      const federalTax = calculateFederalIncomeTax(taxableIncome, filingStatus);
      const { tax: stateTax, effectiveRate: effectiveStateRate } =
        calculateStateTax(income, stateCode, filingStatus);

      const totalTax = federalTax + stateTax;
      const effectiveCombinedRate = income > 0 ? (totalTax / income) * 100 : 0;

      return {
        stateTax,
        federalTax,
        effectiveStateRate,
        effectiveCombinedRate,
      };
    }, [income, stateCode, filingStatus, hasValidInput]);

  const config = stateCode ? STATE_TAX_CONFIG[stateCode] : null;
  const isNoTaxState = config?.type === "no_tax";
  const quarterlyState = stateTax / 4;

  const formatCurrency = (n: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(n);

  const maxTax = Math.max(federalTax, stateTax) || 1;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="sticky top-0 z-50 bg-background border-b border-border">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-3 sm:py-4">
          <div className="flex items-center gap-3 sm:gap-4">
            <div>
              <h1 className="text-lg sm:text-xl font-semibold text-foreground">
                State Tax Calculator
              </h1>
              <p className="text-xs sm:text-sm text-muted-foreground">
                Estimate your state income tax
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">
        {/* Inputs */}
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Calculator className="w-5 h-5" />
              Your Information
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="state">State</Label>
              <Select value={stateCode} onValueChange={setStateCode}>
                <SelectTrigger>
                  <SelectValue placeholder="Select your state" />
                </SelectTrigger>
                <SelectContent>
                  {US_STATES.map((s) => (
                    <SelectItem key={s.code} value={s.code}>
                      <span className="flex items-center gap-2">
                        <MapPin className="w-4 h-4 text-muted-foreground" />
                        {s.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="income">Annual Income ($)</Label>
              <Input
                id="income"
                type="text"
                inputMode="numeric"
                placeholder="e.g. 75000"
                value={incomeStr}
                onChange={(e) => setIncomeStr(e.target.value.replace(/[^0-9]/g, ""))}
                className="text-base"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="filing">Filing Status</Label>
              <Select
                value={filingStatus}
                onValueChange={(v) => setFilingStatus(v as FilingStatus)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FILING_STATUS_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Results */}
        {hasValidInput && (
          <>
            {isNoTaxState ? (
              <Card className="bg-card border-border border-emerald-500/30">
                <CardContent className="pt-6">
                  <div className="flex flex-col items-center text-center py-8">
                    <div className="w-16 h-16 rounded-full bg-emerald-500/20 flex items-center justify-center mb-4">
                      <PartyPopper className="w-8 h-8 text-emerald-500" />
                    </div>
                    <h3 className="text-xl font-semibold text-foreground mb-2">
                      Your state has no income tax!
                    </h3>
                    <p className="text-muted-foreground max-w-sm">
                      {config?.name} does not levy a state income tax on wages.
                      {config?.limitedTax === "interest_dividends" &&
                        " (Interest and dividend income may be taxed.)"}
                    </p>
                    <div className="mt-6 p-4 rounded-lg bg-muted/50 w-full max-w-sm">
                      <p className="text-sm text-muted-foreground">
                        Federal tax estimate:{" "}
                        <span className="font-semibold text-foreground">
                          {formatCurrency(
                            calculateFederalIncomeTax(
                              Math.max(
                                0,
                                income -
                                  (STANDARD_DEDUCTIONS_2024[filingStatus] ?? 14600)
                              ),
                              filingStatus
                            )
                          )}
                        </span>
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <Card className="bg-card border-border">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <DollarSign className="w-5 h-5" />
                    Your Tax Estimate
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-4 rounded-lg bg-muted/50">
                      <p className="text-xs text-muted-foreground uppercase tracking-wide">
                        State Income Tax
                      </p>
                      <p className="text-2xl font-bold text-foreground mt-1">
                        {formatCurrency(stateTax)}
                      </p>
                      <p className="text-sm text-muted-foreground mt-0.5">
                        {effectiveStateRate.toFixed(1)}% effective rate
                      </p>
                    </div>
                    <div className="p-4 rounded-lg bg-muted/50">
                      <p className="text-xs text-muted-foreground uppercase tracking-wide">
                        Federal Income Tax
                      </p>
                      <p className="text-2xl font-bold text-foreground mt-1">
                        {formatCurrency(federalTax)}
                      </p>
                      <p className="text-sm text-muted-foreground mt-0.5">
                        Combined: {effectiveCombinedRate.toFixed(1)}% effective
                      </p>
                    </div>
                  </div>

                  {/* Comparison bar */}
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-foreground">
                      Federal vs State
                    </p>
                    <div className="flex gap-1 h-8 rounded-lg overflow-hidden">
                      <div
                        className="bg-primary flex items-center justify-center text-xs font-medium text-primary-foreground min-w-[60px]"
                        style={{
                          width: `${(federalTax / maxTax) * 100}%`,
                        }}
                      >
                        {federalTax > 0 && formatCurrency(federalTax)}
                      </div>
                      <div
                        className="bg-emerald-600 flex items-center justify-center text-xs font-medium text-white min-w-[60px]"
                        style={{
                          width: `${(stateTax / maxTax) * 100}%`,
                        }}
                      >
                        {stateTax > 0 && formatCurrency(stateTax)}
                      </div>
                    </div>
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>Federal</span>
                      <span>State</span>
                    </div>
                  </div>

                  {/* Quarterly estimated */}
                  <div className="p-4 rounded-lg border border-border bg-background/50">
                    <div className="flex items-center gap-2 mb-2">
                      <TrendingUp className="w-5 h-5 text-primary" />
                      <span className="font-medium text-foreground">
                        Quarterly Estimated State Tax
                      </span>
                    </div>
                    <p className="text-2xl font-bold text-foreground">
                      {formatCurrency(quarterlyState)}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Pay this amount each quarter if you make estimated payments
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default StateTaxCalculatorScreen;
