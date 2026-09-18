"use client";

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  TrendingUp, 
  DollarSign, 
  AlertCircle,
  Home,
  Briefcase,
  Calculator,
  FileText,
  ArrowRight,
  RefreshCw
} from '@/lib/icons';
import { Lightbulb, Target, Car, Phone, Calendar, PieChart } from 'lucide-react';
import { getUserProfile } from '@/lib/firebase/profiles';
import { getUserTaxRate } from '@/lib/tax-rules/federal-brackets';
import { FilingStatusReviewRequiredError } from '@/lib/tax-rules/filing-status';
import { useTransactions } from '@/lib/firebase/hooks';
import type { Transaction } from '@/lib/firebase/transactions';

interface AIInsight {
  id: string;
  title: string;
  description: string;
  category: 'deduction' | 'planning' | 'optimization' | 'warning';
  impact: 'high' | 'medium' | 'low';
  difficulty: 'easy' | 'medium' | 'hard';
  estimatedSavings?: number;
  icon: React.ReactNode;
  actionable: boolean;
  actionText?: string;
  actionUrl?: string;
}

interface UserInsights {
  topOpportunities: AIInsight[];
  monthlySummary: {
    totalDeductions: number;
    potentialSavings: number;
    identifiedDeductions: number;
    confirmedDeductions: number;
  };
  professionInsights: AIInsight[];
  spendingPatternInsights: AIInsight[];
}

interface AIInsightsPageProps {
  user: {
    id: string;
    email?: string;
    user_metadata?: {
      name?: string;
    };
  };
  onBack: () => void;
}

export const AIInsightsPage: React.FC<AIInsightsPageProps> = ({ user, onBack }) => {
  const [insights, setInsights] = useState<UserInsights | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'overview' | 'deductions' | 'planning' | 'patterns'>('overview');
  const [userProfile, setUserProfile] = useState<any>(null);
  const [taxReviewMessage, setTaxReviewMessage] = useState<string | null>(null);
  
  const { transactions } = useTransactions(user.id);

  useEffect(() => {
    const loadUserData = async () => {
      try {
        setIsLoading(true);
        setInsights(null);
        setTaxReviewMessage(null);
        
        // Load user profile
        const { data: profile } = await getUserProfile(user.id);
        setUserProfile(profile);
        
        // Generate insights based on profile and transactions
        const generatedInsights = await generateAIInsights(profile, transactions || []);
        setInsights(generatedInsights);
      } catch (error) {
        if (error instanceof FilingStatusReviewRequiredError) setTaxReviewMessage(error.message);
        console.error('Error loading user data for insights:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadUserData();
  }, [user.id, transactions]);

  const generateAIInsights = async (profile: any, txList: Transaction[]): Promise<UserInsights> => {
    const TAX_RATE_ESTIMATE = getUserTaxRate(profile);
    const effectiveProfile = profile || {
      profession: ['Freelancer'],
      business_purpose: '',
      home_office_sqft: undefined,
      vehicle_business_use_percentage: 0
    };

    // Only the user's own transactions drive totals; an empty account shows zero, not sample data.
    const list: Transaction[] = txList;

    const categoryOrDetail = (t: Transaction) =>
      t.category || t.personal_finance_category?.detailed || t.personal_finance_category?.primary || '';

    const deductibleTransactions = list.filter(t => t.is_deductible === true);
    const totalDeductions = deductibleTransactions.reduce((sum, t) => sum + Math.abs(Number(t.amount)), 0);

    // Likely business-related categories/merchants that might be deductible if not yet marked
    const businessLike = (t: Transaction) => {
      const cat = categoryOrDetail(t).toLowerCase();
      const name = (t.merchant_name || '').toLowerCase();
      return (
        /software|subscription|internet|phone|office|design|advertising|professional|business/.test(cat) ||
        /adobe|canva|zoom|slack|microsoft|google|verizon|at&t|wework|aws/.test(name)
      );
    };

    const potentialDeductions = list.filter(t =>
      t.is_deductible !== true && businessLike(t) && Number(t.amount) < 0
    );
    const potentialSavings = potentialDeductions.reduce(
      (sum, t) => sum + Math.abs(Number(t.amount)) * TAX_RATE_ESTIMATE,
      0
    );

    const professionInsights = generateProfessionInsights(effectiveProfile, list);
    const spendingPatternInsights = generateSpendingPatternInsights(list);

    // Top opportunities: sort by estimatedSavings (desc), then impact, take up to 3; fill with medium if needed
    const bySavings = (a: AIInsight, b: AIInsight) => (b.estimatedSavings ?? 0) - (a.estimatedSavings ?? 0);
    const highImpact = [...professionInsights, ...spendingPatternInsights].filter(i => i.impact === 'high').sort(bySavings);
    const mediumImpact = [...professionInsights, ...spendingPatternInsights].filter(i => i.impact === 'medium').sort(bySavings);
    const topOpportunities = [...highImpact, ...mediumImpact].slice(0, 3);

    return {
      topOpportunities,
      monthlySummary: {
        totalDeductions,
        potentialSavings,
        identifiedDeductions: potentialDeductions.length,
        confirmedDeductions: deductibleTransactions.length
      },
      professionInsights,
      spendingPatternInsights
    };
  };

  const generateProfessionInsights = (profile: any, transactions: Transaction[]): AIInsight[] => {
    const insights: AIInsight[] = [];
    const profession = (Array.isArray(profile?.profession) ? profile.profession[0] : profile?.profession) || 'Freelancer';
    const profLower = String(profession).toLowerCase();

    // Freelance Designer / creative insights
    // Illustrative examples; actual savings computed from user transactions when available
    if (profLower.includes('design') || profLower.includes('freelance') || profLower.includes('creative') || profLower.includes('graphic')) {
      insights.push({
        id: 'design-software-deduction',
        title: 'Design Software Deductions',
        description: 'Design software subscriptions used in your business (for example Adobe Creative Cloud or Canva) are generally deductible; allocate any personal use. Keep the invoices and note the business purpose.',
        category: 'deduction',
        impact: 'high',
        difficulty: 'easy',
        icon: <FileText className="w-5 h-5" />,
        actionable: true,
        actionText: 'Mark as Business Expense',
        actionUrl: '/protected/transactions'
      });

      insights.push({
        id: 'home-office-setup',
        title: 'Home Office Deduction',
        description: 'If part of your home is used regularly and exclusively for your business, you may deduct a share of rent or mortgage interest, utilities and internet using the simplified method ($5 per square foot, up to 300 square feet) or actual expenses.',
        category: 'deduction',
        impact: 'high',
        difficulty: 'medium',
        icon: <Home className="w-5 h-5" />,
        actionable: true,
        actionText: 'Set Up Home Office',
        actionUrl: '/protected/settings'
      });

      insights.push({
        id: 'phone-bill-deduction',
        title: 'Business Phone Usage',
        description: 'If you use your phone for client calls and business email, the business-use percentage of the bill may be deductible. Keep a record of how you estimated the percentage.',
        category: 'deduction',
        impact: 'medium',
        difficulty: 'easy',
        icon: <Phone className="w-5 h-5" />,
        actionable: true,
        actionText: 'Track Phone Usage',
        actionUrl: '/protected/transactions'
      });
    }

    // Uber/Lyft driver insights
    // Illustrative examples; actual savings computed from user transactions when available
    if (profLower.includes('uber') || profLower.includes('lyft') || profLower.includes('driver') || profLower.includes('rideshare')) {
      insights.push({
        id: 'mileage-deduction',
        title: 'Mileage Tracking',
        description: 'Keep a dated log of your business miles for rideshare driving. The IRS standard mileage rate is set each year and may exceed your actual vehicle costs.',
        category: 'deduction',
        impact: 'high',
        difficulty: 'easy',
        icon: <Car className="w-5 h-5" />,
        actionable: true,
        actionText: 'Start Mileage Log',
        actionUrl: '/protected/transactions'
      });

      insights.push({
        id: 'quarterly-taxes',
        title: 'Quarterly Tax Payments',
        description: 'Many drivers set aside a share of each payout for federal and state estimated taxes. Use the quarterly planner to compare the 90% current-year and 100%/110% prior-year safe-harbor targets for your facts.',
        category: 'planning',
        impact: 'high',
        difficulty: 'medium',
        icon: <Calculator className="w-5 h-5" />,
        actionable: true,
        actionText: 'Set Up Payments',
        actionUrl: '/protected/settings'
      });
    }

    // Consultant / developer / writer (software, tools, home office)
    // Illustrative examples; actual savings computed from user transactions when available
    if (profLower.includes('consultant') || profLower.includes('developer') || profLower.includes('writer') || profLower.includes('software')) {
      insights.push({
        id: 'software-tools-deduction',
        title: 'Software & Tools Deductions',
        description: 'Development tools, cloud services and productivity software used in your business are generally deductible. Track subscriptions such as GitHub, AWS or Notion and note any personal use.',
        category: 'deduction',
        impact: 'high',
        difficulty: 'easy',
        icon: <FileText className="w-5 h-5" />,
        actionable: true,
        actionText: 'Review Subscriptions',
        actionUrl: '/protected/transactions'
      });
    }

    // General freelancer insights
    insights.push({
      id: 'business-expenses',
      title: 'Business Expense Tracking',
      description: 'Keep receipts for business-related expenses. Software subscriptions, equipment and professional development related to your current business are commonly deductible; equipment may need to be depreciated.',
      category: 'deduction',
      impact: 'medium',
      difficulty: 'easy',
      icon: <Briefcase className="w-5 h-5" />,
      actionable: true,
      actionText: 'Review Expenses',
      actionUrl: '/protected/transactions'
    });

    return insights;
  };

  const generateSpendingPatternInsights = (transactions: Transaction[]): AIInsight[] => {
    const insights: AIInsight[] = [];
    const cat = (t: Transaction) => t.category || t.personal_finance_category?.detailed || t.personal_finance_category?.primary || '';
    const name = (t: Transaction) => (t.merchant_name || '').toLowerCase();

    const subscriptions = transactions.filter(t =>
      /software|subscription|recurring/.test(cat(t).toLowerCase()) ||
      /adobe|canva|zoom|slack|microsoft 365|notion/.test(name(t))
    );

    if (subscriptions.length > 0) {
      insights.push({
        id: 'subscription-optimization',
        title: 'Subscription Audit',
        description: `You have ${subscriptions.length} recurring subscriptions. Review which ones are business-related and mark them as deductible.`,
        category: 'optimization',
        impact: 'medium',
        difficulty: 'easy',
        icon: <TrendingUp className="w-5 h-5" />,
        actionable: true,
        actionText: 'Review Subscriptions',
        actionUrl: '/protected/transactions'
      });
    }

    const meals = transactions.filter(t =>
      /meal|food|restaurant|dining|coffee/.test(cat(t).toLowerCase()) ||
      /starbucks|restaurant|cafe|chipotle|doordash|uber eats/.test(name(t))
    );

    if (meals.length > 0) {
      insights.push({
        id: 'meal-deduction-rules',
        title: 'Meal Deduction Rules',
        description: 'Business meals are generally only 50% deductible and entertainment is not deductible. Keep records of who attended and the business purpose.',
        category: 'warning',
        impact: 'medium',
        difficulty: 'medium',
        icon: <AlertCircle className="w-5 h-5" />,
        actionable: true,
        actionText: 'Track Meal Details',
        actionUrl: '/protected/transactions'
      });
    }

    return insights;
  };

  const getImpactColor = (impact: string) => {
    switch (impact) {
      case 'high': return 'bg-green-700/15 dark:bg-green-600/20 text-green-800 dark:text-green-200 border-green-600/30';
      case 'medium': return 'bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200 border-amber-300 dark:border-amber-700';
      case 'low': return 'bg-muted text-muted-foreground border-border';
      default: return 'bg-muted text-muted-foreground border-border';
    }
  };

  const getCategoryColor = (category: string) => {
    switch (category) {
      case 'deduction': return 'bg-green-500/5 dark:bg-green-600/10 border-green-600/20 dark:border-green-500/20';
      case 'planning': return 'bg-violet-500/5 dark:bg-violet-600/10 border-violet-600/20 dark:border-violet-500/20';
      case 'optimization': return 'bg-emerald-500/5 dark:bg-emerald-600/10 border-emerald-600/20';
      case 'warning': return 'bg-amber-500/5 dark:bg-amber-600/10 border-amber-600/20';
      default: return 'bg-muted/30 dark:bg-muted/20 border-border';
    }
  };

  const professionLabel = (Array.isArray(userProfile?.profession) ? userProfile?.profession[0] : userProfile?.profession) || 'Freelancer';

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <RefreshCw className="w-8 h-8 animate-spin text-green-600 dark:text-green-400 mx-auto mb-4" />
          <p className="text-muted-foreground">Analyzing your financial patterns...</p>
        </div>
      </div>
    );
  }

  if (!insights) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <AlertCircle className="w-8 h-8 text-amber-500 mx-auto mb-4" />
          <p role={taxReviewMessage ? 'alert' : undefined} className="text-muted-foreground">{taxReviewMessage || 'Unable to generate insights. Please try again.'}</p>
          {taxReviewMessage && <Link className="mt-4 block underline" href="/protected/settings">Review profile</Link>}
          <Button onClick={onBack} variant="outline" className="mt-4">Go Back</Button>
        </div>
      </div>
    );
  }

  const tabs = [
    { id: 'overview' as const, label: 'Overview', icon: <Target className="w-4 h-4" /> },
    { id: 'deductions' as const, label: 'Deductions', icon: <DollarSign className="w-4 h-4" /> },
    { id: 'planning' as const, label: 'Planning', icon: <Calendar className="w-4 h-4" /> },
    { id: 'patterns' as const, label: 'Patterns', icon: <PieChart className="w-4 h-4" /> }
  ];

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="bg-card border-b border-border sticky top-0 z-50 shadow-sm">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-4 sm:p-6">
          <div className="flex items-center gap-3 sm:gap-4 w-full sm:w-auto">
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl font-bold text-foreground">AI Tax Insights</h1>
              <p className="text-sm text-muted-foreground">Personalized tax-saving opportunities</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0 rounded-lg bg-muted/50 dark:bg-muted/30 px-3 py-1.5">
            <Lightbulb className="w-5 h-5 text-green-600 dark:text-green-400" />
            <span className="text-sm font-medium text-foreground">{professionLabel}</span>
          </div>
        </div>
      </header>

      <div className="p-4 sm:p-6 max-w-6xl mx-auto">
        {/* Summary Card */}
        <Card className="p-4 sm:p-6 mb-6 sm:mb-8 border border-border bg-card">
          <h2 className="text-lg sm:text-xl font-semibold text-foreground mb-1">
            Your Top Tax-Saving Opportunities
          </h2>
          <p className="text-sm text-muted-foreground mb-4 sm:mb-6">
            Based on your {professionLabel} profile and spending patterns
          </p>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
            <div className="rounded-lg bg-muted/40 dark:bg-muted/20 p-3 sm:p-4 text-center">
              <div className="text-xl sm:text-2xl font-bold text-foreground">{insights.monthlySummary.confirmedDeductions}</div>
              <div className="text-xs sm:text-sm text-muted-foreground mt-0.5">Confirmed Deductions</div>
            </div>
            <div className="rounded-lg bg-muted/40 dark:bg-muted/20 p-3 sm:p-4 text-center">
              <div className="text-xl sm:text-2xl font-bold text-foreground">{insights.monthlySummary.identifiedDeductions}</div>
              <div className="text-xs sm:text-sm text-muted-foreground mt-0.5">New Opportunities</div>
            </div>
            <div className="rounded-lg bg-green-600/10 dark:bg-green-600/15 p-3 sm:p-4 text-center">
              <div className="text-xl sm:text-2xl font-bold text-green-700 dark:text-green-300">${Math.round(insights.monthlySummary.potentialSavings)}</div>
              <div className="text-xs sm:text-sm text-muted-foreground mt-0.5">Estimated Tax Effect of Unreviewed Items</div>
            </div>
            <div className="rounded-lg bg-muted/40 dark:bg-muted/20 p-3 sm:p-4 text-center">
              <div className="text-xl sm:text-2xl font-bold text-foreground">${Math.round(insights.monthlySummary.totalDeductions)}</div>
              <div className="text-xs sm:text-sm text-muted-foreground mt-0.5">Confirmed Deduction Total</div>
            </div>
          </div>
        </Card>

        {/* Tab Navigation */}
        <div className="flex gap-1 p-1 rounded-lg bg-muted/40 dark:bg-muted/30 mb-6 overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-3 sm:px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2 whitespace-nowrap shrink-0 ${
                activeTab === tab.id
                  ? 'bg-green-600 text-white shadow-sm dark:bg-green-600 dark:text-white'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            <h3 className="text-lg font-semibold text-foreground">Top Opportunities</h3>
            {insights.topOpportunities.length === 0 ? (
              <Card className="p-8 text-center border-border bg-card">
                <Lightbulb className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                <p className="text-muted-foreground">Add transactions and complete your profile to see personalized opportunities.</p>
                <Button asChild variant="outline" className="mt-4">
                  <Link href="/protected/transactions">View Transactions</Link>
                </Button>
              </Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
                {insights.topOpportunities.map((insight) => (
                  <Card key={insight.id} className={`p-4 sm:p-6 border transition-all hover:shadow-md ${getCategoryColor(insight.category)}`}>
                    <div className="flex items-start gap-3 sm:gap-4">
                      <div className="p-2 rounded-lg bg-background/80 dark:bg-muted shrink-0">{insight.icon}</div>
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2 mb-2">
                          <h4 className="font-semibold text-foreground">{insight.title}</h4>
                          <Badge className={`text-xs border ${getImpactColor(insight.impact)}`}>{insight.impact} impact</Badge>
                        </div>
                        <p className="text-sm text-muted-foreground mb-3">{insight.description}</p>
                        {insight.estimatedSavings != null && insight.estimatedSavings > 0 && (
                          <p className="text-base font-semibold text-green-700 dark:text-green-300 mb-3">Estimated tax effect: about ${insight.estimatedSavings}/year, based on your recorded expenses</p>
                        )}
                        {insight.actionable && insight.actionText && insight.actionUrl && (
                          <Button size="sm" variant="outline" className="w-full text-foreground border-foreground/30 hover:bg-muted" asChild>
                            <Link href={insight.actionUrl}>{insight.actionText}<ArrowRight className="w-4 h-4 ml-2 inline" /></Link>
                          </Button>
                        )}
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'deductions' && (
          <div className="space-y-6">
            <h3 className="text-lg font-semibold text-foreground">Deduction Opportunities</h3>
            {(() => {
              const deductionInsights = insights.professionInsights.filter(i => i.category === 'deduction');
              if (deductionInsights.length === 0) {
                return (
                  <Card className="p-8 text-center border-border bg-card">
                    <DollarSign className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                    <p className="text-muted-foreground">No deduction-specific insights yet. Complete your profile and add transactions to see recommendations.</p>
                  </Card>
                );
              }
              return (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
                  {deductionInsights.map((insight) => (
                    <Card key={insight.id} className={`p-4 sm:p-6 border transition-all hover:shadow-md ${getCategoryColor(insight.category)}`}>
                      <div className="flex items-start gap-3 sm:gap-4">
                        <div className="p-2 rounded-lg bg-background/80 dark:bg-muted shrink-0">{insight.icon}</div>
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2 mb-2">
                            <h4 className="font-semibold text-foreground">{insight.title}</h4>
                            <Badge className={`text-xs border ${getImpactColor(insight.impact)}`}>{insight.impact}</Badge>
                          </div>
                          <p className="text-sm text-muted-foreground mb-3">{insight.description}</p>
                          {insight.estimatedSavings != null && insight.estimatedSavings > 0 && (
                            <p className="text-base font-semibold text-green-700 dark:text-green-300 mb-3">Estimated tax effect: about ${insight.estimatedSavings}/year, based on your recorded expenses</p>
                          )}
                          {insight.actionable && insight.actionText && insight.actionUrl && (
                            <Button size="sm" variant="outline" className="w-full text-foreground border-foreground/30 hover:bg-muted" asChild>
                              <Link href={insight.actionUrl}>{insight.actionText}<ArrowRight className="w-4 h-4 ml-2 inline" /></Link>
                            </Button>
                          )}
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              );
            })()}
          </div>
        )}

        {activeTab === 'planning' && (
          <div className="space-y-6">
            <h3 className="text-lg font-semibold text-foreground">Tax Planning</h3>
            {(() => {
              const planningInsights = insights.professionInsights.filter(i => i.category === 'planning');
              if (planningInsights.length === 0) {
                return (
                  <Card className="p-8 text-center border-border bg-card">
                    <Calendar className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                    <p className="text-muted-foreground">No planning insights for your profile yet. Check back after we learn more about your business.</p>
                  </Card>
                );
              }
              return (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
                  {planningInsights.map((insight) => (
                    <Card key={insight.id} className={`p-4 sm:p-6 border transition-all hover:shadow-md ${getCategoryColor(insight.category)}`}>
                      <div className="flex items-start gap-3 sm:gap-4">
                        <div className="p-2 rounded-lg bg-background/80 dark:bg-muted shrink-0">{insight.icon}</div>
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2 mb-2">
                            <h4 className="font-semibold text-foreground">{insight.title}</h4>
                            <Badge className={`text-xs border ${getImpactColor(insight.impact)}`}>{insight.impact}</Badge>
                          </div>
                          <p className="text-sm text-muted-foreground mb-3">{insight.description}</p>
                          {insight.estimatedSavings != null && insight.estimatedSavings > 0 && (
                            <p className="text-base font-semibold text-green-700 dark:text-green-300 mb-3">Estimated tax effect: about ${insight.estimatedSavings}/year, based on your recorded expenses</p>
                          )}
                          {insight.actionable && insight.actionText && insight.actionUrl && (
                            <Button size="sm" variant="outline" className="w-full text-foreground border-foreground/30 hover:bg-muted" asChild>
                              <Link href={insight.actionUrl}>{insight.actionText}<ArrowRight className="w-4 h-4 ml-2 inline" /></Link>
                            </Button>
                          )}
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              );
            })()}
          </div>
        )}

        {activeTab === 'patterns' && (
          <div className="space-y-6">
            <h3 className="text-lg font-semibold text-foreground">Spending Pattern Insights</h3>
            {insights.spendingPatternInsights.length === 0 ? (
              <Card className="p-8 text-center border-border bg-card">
                <PieChart className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                <p className="text-muted-foreground">Connect accounts and add more transactions to see pattern-based insights.</p>
              </Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
                {insights.spendingPatternInsights.map((insight) => (
                  <Card key={insight.id} className={`p-4 sm:p-6 border transition-all hover:shadow-md ${getCategoryColor(insight.category)}`}>
                    <div className="flex items-start gap-3 sm:gap-4">
                      <div className="p-2 rounded-lg bg-background/80 dark:bg-muted shrink-0">{insight.icon}</div>
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2 mb-2">
                          <h4 className="font-semibold text-foreground">{insight.title}</h4>
                          <Badge className={`text-xs border ${getImpactColor(insight.impact)}`}>{insight.impact}</Badge>
                        </div>
                        <p className="text-sm text-muted-foreground mb-3">{insight.description}</p>
                        {insight.estimatedSavings != null && insight.estimatedSavings > 0 && (
                          <p className="text-base font-semibold text-green-700 dark:text-green-300 mb-3">Estimated tax effect: about ${insight.estimatedSavings}/year, based on your recorded expenses</p>
                        )}
                        {insight.actionable && insight.actionText && insight.actionUrl && (
                          <Button size="sm" variant="outline" className="w-full text-foreground border-foreground/30 hover:bg-muted" asChild>
                            <Link href={insight.actionUrl}>{insight.actionText}<ArrowRight className="w-4 h-4 ml-2 inline" /></Link>
                          </Button>
                        )}
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
