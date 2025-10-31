'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  Calculator, 
  Calendar, 
  DollarSign, 
  TrendingUp, 
  AlertCircle,
  CheckCircle,
  Download,
  Clock,
  Target,
  FileText
} from 'lucide-react';

interface QuarterlyTaxData {
  quarter: number;
  deadline: Date;
  estimatedAmount: number;
  paidAmount: number;
  remainingAmount: number;
  status: 'upcoming' | 'due' | 'overdue' | 'paid';
  daysUntilDeadline: number;
}

interface TaxCalculation {
  totalIncome: number;
  businessIncome: number;
  w2Income: number;
  estimatedTax: number;
  selfEmploymentTax: number;
  incomeTax: number;
  safeHarborAmount: number;
  quarterlyAmount: number;
  ytdPayments: number;
  remainingPayments: number;
}

interface QuarterlyTaxCalculatorProps {
  userProfile?: {
    business_income?: number;
    w2_income?: number;
    other_income?: number;
    tax_bracket?: number;
    filing_status?: string;
    state?: string;
  };
  transactions?: any[];
}

export function QuarterlyTaxCalculator({ userProfile, transactions }: QuarterlyTaxCalculatorProps) {
  const [taxCalculation, setTaxCalculation] = useState<TaxCalculation | null>(null);
  const [quarterlyData, setQuarterlyData] = useState<QuarterlyTaxData[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [activeQuarter, setActiveQuarter] = useState(1);

  useEffect(() => {
    if (userProfile) {
      calculateTaxes();
    }
  }, [userProfile, transactions]);

  const calculateTaxes = async () => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/tax/quarterly-estimates', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userProfile,
          transactions: transactions || []
        }),
      });

      if (response.ok) {
        const data = await response.json();
        setTaxCalculation(data.calculation);
        setQuarterlyData(data.quarterlyData);
      }
    } catch (error) {
      console.error('Error calculating taxes:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const getQuarterStatus = (quarter: QuarterlyTaxData) => {
    if (quarter.status === 'paid') return 'success';
    if (quarter.status === 'overdue') return 'destructive';
    if (quarter.status === 'due') return 'warning';
    return 'secondary';
  };

  const getQuarterStatusText = (quarter: QuarterlyTaxData) => {
    if (quarter.status === 'paid') return 'Paid';
    if (quarter.status === 'overdue') return 'Overdue';
    if (quarter.status === 'due') return 'Due Soon';
    return 'Upcoming';
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const generateForm1040ES = async (quarter: number) => {
    try {
      const response = await fetch('/api/tax/generate-1040es', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          quarter,
          userProfile,
          taxCalculation
        }),
      });

      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Form-1040-ES-Q${quarter}-${new Date().getFullYear()}.pdf`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      }
    } catch (error) {
      console.error('Error generating Form 1040-ES:', error);
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-600"></div>
            <span className="ml-2">Calculating your quarterly taxes...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!taxCalculation) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="text-center">
            <Calculator className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">Quarterly Tax Calculator</h3>
            <p className="text-muted-foreground mb-4">
              Complete your profile to get personalized quarterly tax estimates.
            </p>
            <Button onClick={() => window.location.href = '/protected?screen=settings'}>
              Complete Profile
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calculator className="h-5 w-5 text-teal-600" />
            Quarterly Tax Summary
          </CardTitle>
          <CardDescription>
            Your estimated quarterly tax payments for {new Date().getFullYear()}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="text-center p-4 bg-blue-50 rounded-lg">
              <DollarSign className="h-8 w-8 text-blue-600 mx-auto mb-2" />
              <div className="text-2xl font-bold text-blue-900">
                {formatCurrency(taxCalculation.quarterlyAmount)}
              </div>
              <div className="text-sm text-blue-700">Per Quarter</div>
            </div>
            <div className="text-center p-4 bg-green-50 rounded-lg">
              <CheckCircle className="h-8 w-8 text-green-600 mx-auto mb-2" />
              <div className="text-2xl font-bold text-green-900">
                {formatCurrency(taxCalculation.ytdPayments)}
              </div>
              <div className="text-sm text-green-700">Paid YTD</div>
            </div>
            <div className="text-center p-4 bg-orange-50 rounded-lg">
              <Target className="h-8 w-8 text-orange-600 mx-auto mb-2" />
              <div className="text-2xl font-bold text-orange-900">
                {formatCurrency(taxCalculation.remainingPayments)}
              </div>
              <div className="text-sm text-orange-700">Remaining</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Quarterly Breakdown */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5 text-teal-600" />
            Quarterly Breakdown
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs value={activeQuarter.toString()} onValueChange={(value) => setActiveQuarter(parseInt(value))}>
            <TabsList className="grid w-full grid-cols-4">
              {quarterlyData.map((quarter) => (
                <TabsTrigger key={quarter.quarter} value={quarter.quarter.toString()}>
                  Q{quarter.quarter}
                </TabsTrigger>
              ))}
            </TabsList>
            
            {quarterlyData.map((quarter) => (
              <TabsContent key={quarter.quarter} value={quarter.quarter.toString()}>
                <div className="space-y-4">
                  {/* Quarter Status */}
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-lg font-semibold">Q{quarter.quarter} {new Date().getFullYear()}</h3>
                      <p className="text-sm text-muted-foreground">
                        Due: {new Date(quarter.deadline).toLocaleDateString()}
                      </p>
                    </div>
                    <Badge variant={getQuarterStatus(quarter)}>
                      {getQuarterStatusText(quarter)}
                    </Badge>
                  </div>

                  {/* Progress Bar */}
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span>Payment Progress</span>
                      <span>{formatCurrency(quarter.paidAmount)} / {formatCurrency(quarter.estimatedAmount)}</span>
                    </div>
                    <Progress 
                      value={(quarter.paidAmount / quarter.estimatedAmount) * 100} 
                      className="h-2"
                    />
                  </div>

                  {/* Amount Details */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-3 bg-gray-50 rounded-lg">
                      <div className="text-sm text-muted-foreground">Estimated Amount</div>
                      <div className="text-lg font-semibold">{formatCurrency(quarter.estimatedAmount)}</div>
                    </div>
                    <div className="p-3 bg-gray-50 rounded-lg">
                      <div className="text-sm text-muted-foreground">Remaining</div>
                      <div className="text-lg font-semibold">{formatCurrency(quarter.remainingAmount)}</div>
                    </div>
                  </div>

                  {/* Days Until Deadline */}
                  {quarter.status !== 'paid' && (
                    <div className="flex items-center gap-2 p-3 bg-amber-50 rounded-lg">
                      <Clock className="h-4 w-4 text-amber-600" />
                      <span className="text-sm text-amber-800">
                        {quarter.daysUntilDeadline > 0 
                          ? `${quarter.daysUntilDeadline} days until deadline`
                          : `${Math.abs(quarter.daysUntilDeadline)} days overdue`
                        }
                      </span>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex gap-2">
                    <Button 
                      onClick={() => generateForm1040ES(quarter.quarter)}
                      className="flex-1"
                    >
                      <Download className="h-4 w-4 mr-2" />
                      Generate Form 1040-ES
                    </Button>
                    <Button variant="outline">
                      <FileText className="h-4 w-4 mr-2" />
                      Payment Options
                    </Button>
                  </div>
                </div>
              </TabsContent>
            ))}
          </Tabs>
        </CardContent>
      </Card>

      {/* Tax Calculation Details */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-teal-600" />
            Calculation Details
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Business Income</span>
                  <span className="font-medium">{formatCurrency(taxCalculation.businessIncome)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">W-2 Income</span>
                  <span className="font-medium">{formatCurrency(taxCalculation.w2Income)}</span>
                </div>
                <div className="flex justify-between border-t pt-2">
                  <span className="font-medium">Total Income</span>
                  <span className="font-semibold">{formatCurrency(taxCalculation.totalIncome)}</span>
                </div>
              </div>
              
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Self-Employment Tax</span>
                  <span className="font-medium">{formatCurrency(taxCalculation.selfEmploymentTax)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Income Tax</span>
                  <span className="font-medium">{formatCurrency(taxCalculation.incomeTax)}</span>
                </div>
                <div className="flex justify-between border-t pt-2">
                  <span className="font-medium">Total Estimated Tax</span>
                  <span className="font-semibold">{formatCurrency(taxCalculation.estimatedTax)}</span>
                </div>
              </div>
            </div>

            {/* Safe Harbor Information */}
            <div className="p-4 bg-blue-50 rounded-lg">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-5 w-5 text-blue-600 mt-0.5" />
                <div>
                  <h4 className="font-medium text-blue-900">Safe Harbor Rule</h4>
                  <p className="text-sm text-blue-800 mt-1">
                    You can avoid penalties by paying at least {formatCurrency(taxCalculation.safeHarborAmount)} 
                    (100% of last year's tax) or {formatCurrency(taxCalculation.estimatedTax)} 
                    (90% of current year's tax), whichever is smaller.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
