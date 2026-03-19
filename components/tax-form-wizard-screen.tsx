"use client";

import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle,
  FileText,
  HelpCircle,
  ClipboardList,
  X,
} from "lucide-react";

interface TaxFormWizardScreenProps {
  user: { id: string; email?: string };
  userProfile?: any;
  onBack: () => void;
}

const TOTAL_STEPS = 7;

const QUESTIONS: { key: string; question: string }[] = [
  {
    key: "self_employment",
    question: "Do you have self-employment or freelance income?",
  },
  {
    key: "home_office",
    question: "Do you use part of your home for business?",
  },
  {
    key: "equipment",
    question: "Did you purchase business equipment or assets over $2,500?",
  },
  {
    key: "investments",
    question: "Do you have investment or crypto income?",
  },
  {
    key: "hsa",
    question: "Do you contribute to an HSA?",
  },
  {
    key: "contractors",
    question: "Did you pay any contractors over $600?",
  },
  {
    key: "partnership",
    question: "Do you have income from partnerships or S-Corps?",
  },
];

const FORMS = [
  {
    key: "schedule_c",
    name: "Schedule C (Profit or Loss)",
    description: "Reports business income and expenses for sole proprietors",
    neededIf: (a: Record<string, boolean>) => a.self_employment,
  },
  {
    key: "schedule_se",
    name: "Schedule SE (Self-Employment Tax)",
    description: "Calculates self-employment tax on net business income",
    neededIf: (a: Record<string, boolean>) => a.self_employment,
  },
  {
    key: "form_1040_es",
    name: "Form 1040-ES (Estimated Tax)",
    description: "Quarterly estimated tax payments for self-employed",
    neededIf: (a: Record<string, boolean>) => a.self_employment,
  },
  {
    key: "form_8829",
    name: "Form 8829 (Home Office)",
    description: "Deduction for business use of your home",
    neededIf: (a: Record<string, boolean>) => a.home_office,
  },
  {
    key: "form_4562",
    name: "Form 4562 (Depreciation)",
    description: "Depreciation and amortization of business assets",
    neededIf: (a: Record<string, boolean>) => a.equipment,
  },
  {
    key: "schedule_d",
    name: "Schedule D (Capital Gains)",
    description: "Capital gains and losses from investments",
    neededIf: (a: Record<string, boolean>) => a.investments,
  },
  {
    key: "form_8949",
    name: "Form 8949 (Sales of Assets)",
    description: "Sales and dispositions of capital assets",
    neededIf: (a: Record<string, boolean>) => a.investments,
  },
  {
    key: "form_8889",
    name: "Form 8889 (HSA)",
    description: "Health Savings Account contributions and distributions",
    neededIf: (a: Record<string, boolean>) => a.hsa,
  },
  {
    key: "form_1099_nec",
    name: "Form 1099-NEC (for contractors)",
    description: "Report payments to contractors over $600",
    neededIf: (a: Record<string, boolean>) => a.contractors,
  },
  {
    key: "schedule_k1",
    name: "Schedule K-1 (Partnership/S-Corp)",
    description: "Income from partnerships or S corporations",
    neededIf: (a: Record<string, boolean>) => a.partnership,
  },
  {
    key: "state_return",
    name: "State tax return",
    description: "Check your state requirements",
    neededIf: () => true,
    alwaysShow: true,
  },
];

function getInitialAnswers(userProfile?: any): Record<string, boolean> {
  const defaults: Record<string, boolean> = {
    self_employment: false,
    home_office: false,
    equipment: false,
    investments: false,
    hsa: false,
    contractors: false,
    partnership: false,
  };

  if (!userProfile) return defaults;

  if (
    userProfile.business_income > 0 ||
    userProfile.income_breakdown?.business_income > 0
  ) {
    defaults.self_employment = true;
  }
  if (
    (userProfile.home_office_sqft ?? 0) > 0 ||
    userProfile.home_office_details
  ) {
    defaults.home_office = true;
  }

  return defaults;
}

export function TaxFormWizardScreen({
  user,
  userProfile,
  onBack,
}: TaxFormWizardScreenProps) {
  const [step, setStep] = useState(1);
  const [answers, setAnswers] = useState<Record<string, boolean>>(() =>
    getInitialAnswers(userProfile)
  );

  const currentQuestion = QUESTIONS[step - 1];
  const isResults = step > TOTAL_STEPS;

  const handleAnswer = (value: boolean) => {
    if (!currentQuestion) return;
    setAnswers((prev) => ({ ...prev, [currentQuestion.key]: value }));
    if (step < TOTAL_STEPS) {
      setStep(step + 1);
    } else {
      setStep(TOTAL_STEPS + 1);
    }
  };

  const handleStartOver = () => {
    setStep(1);
    setAnswers(getInitialAnswers(userProfile));
  };

  const handleBack = () => {
    if (step > 1 && !isResults) {
      setStep(step - 1);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="sticky top-0 z-50 bg-background border-b border-border">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-3 sm:py-4">
          <div className="flex items-center gap-3 sm:gap-4">
            <Button onClick={onBack} variant="ghost" size="icon">
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div>
              <h1 className="text-lg sm:text-xl font-semibold text-foreground">
                Tax Form Wizard
              </h1>
              <p className="text-xs sm:text-sm text-muted-foreground">
                Find out which forms you need to file
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {/* Progress bar */}
        {!isResults && (
          <div className="mb-6 sm:mb-8">
            <div className="flex justify-between text-xs text-muted-foreground mb-2">
              <span>Step {step} of {TOTAL_STEPS}</span>
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-300"
                style={{ width: `${(step / TOTAL_STEPS) * 100}%` }}
              />
            </div>
          </div>
        )}

        {/* Question step */}
        {!isResults && currentQuestion && (
          <Card className="bg-card border-border">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
                <HelpCircle className="w-5 h-5 text-primary shrink-0" />
                {currentQuestion.question}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-col sm:flex-row gap-3">
                <Button
                  onClick={() => handleAnswer(true)}
                  className="flex-1 h-12 sm:h-14 text-base font-medium"
                >
                  Yes
                </Button>
                <Button
                  onClick={() => handleAnswer(false)}
                  variant="outline"
                  className="flex-1 h-12 sm:h-14 text-base font-medium"
                >
                  No
                </Button>
              </div>
              {step > 1 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleBack}
                  className="text-muted-foreground"
                >
                  <ArrowLeft className="w-4 h-4 mr-1" />
                  Back
                </Button>
              )}
            </CardContent>
          </Card>
        )}

        {/* Results */}
        {isResults && (
          <div className="space-y-6">
            <Card className="bg-card border-border">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <ClipboardList className="w-6 h-6 text-primary" />
                  <CardTitle>Forms You May Need</CardTitle>
                </div>
                <p className="text-sm text-muted-foreground">
                  Based on your answers, here are the IRS forms that may apply to
                  your situation.
                </p>
              </CardHeader>
              <CardContent className="space-y-4">
                {FORMS.map((form) => {
                  const needed =
                    form.alwaysShow || form.neededIf(answers);
                  return (
                    <div
                      key={form.key}
                      className="flex items-start gap-4 p-4 rounded-lg border border-border bg-background/50"
                    >
                      <div className="shrink-0 mt-0.5">
                        {needed ? (
                          <CheckCircle className="w-6 h-6 text-emerald-500" />
                        ) : (
                          <X className="w-6 h-6 text-muted-foreground" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-foreground">
                            {form.name}
                          </span>
                          {needed && (
                            <Badge variant="default" className="text-xs">
                              Needed
                            </Badge>
                          )}
                          {!needed && !form.alwaysShow && (
                            <Badge variant="secondary" className="text-xs">
                              Not needed
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground mt-1">
                          {form.description}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>

            <div className="flex justify-center">
              <Button
                variant="outline"
                onClick={handleStartOver}
                className="gap-2"
              >
                <FileText className="w-4 h-4" />
                Start Over
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
