"use client";

import React, { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { 
  TrendingUp, 
  DollarSign, 
  CheckCircle, 
  AlertCircle,
  Home,
  Briefcase,
  Calculator,
  FileText,
  ArrowRight,
  RefreshCw
} from '@/lib/icons';
import { Lightbulb, Target, Car, Phone } from 'lucide-react';
import { getUserProfile } from '@/lib/firebase/profiles';
import { useTransactions } from '@/lib/firebase/hooks';

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
  
  const { data: transactions, error: transactionsError } = useTransactions(user.id);

  useEffect(() => {
    const loadUserData = async () => {
      try {
        setIsLoading(true);
        
        // Load user profile
        const { data: profile } = await getUserProfile(user.id);
        setUserProfile(profile);
        
        // Generate insights based on profile and transactions
        const generatedInsights = await generateAIInsights(profile, transactions || []);
        setInsights(generatedInsights);
      } catch (error) {
        console.error('Error loading user data for insights:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadUserData();
  }, [user.id, transactions]);

  const generateAIInsights = async (profile: any, transactions: any[]): Promise<UserInsights> => {
    // Mock data for testing if no real data available
    const mockProfile = profile || {
      profession: ['Freelance Designer'],
      business_purpose: 'Graphic design and branding services',
      home_office_sqft: 150,
      vehicle_business_use_percentage: 0
    };

    const mockTransactions = transactions.length > 0 ? transactions : [
      { 
        merchant_name: "Canva", 
        category: "Design Software", 
        amount: 12.99, 
        is_deductible: true,
        date: new Date().toISOString().split('T')[0]
      },
      { 
        merchant_name: "Starbucks", 
        category: "Meals", 
        amount: 8.50, 
        is_deductible: false,
        date: new Date().toISOString().split('T')[0]
      },
      { 
        merchant_name: "Zoom", 
        category: "Subscriptions", 
        amount: 15.00, 
        is_deductible: true,
        date: new Date().toISOString().split('T')[0]
      },
      { 
        merchant_name: "Adobe Creative Cloud", 
        category: "Software", 
        amount: 52.99, 
        is_deductible: true,
        date: new Date().toISOString().split('T')[0]
      },
      { 
        merchant_name: "Verizon", 
        category: "Phone", 
        amount: 89.99, 
        is_deductible: false,
        date: new Date().toISOString().split('T')[0]
      }
    ];

    // Analyze transaction patterns
    const deductibleTransactions = mockTransactions.filter(t => t.is_deductible);
    const totalDeductions = deductibleTransactions.reduce((sum, t) => sum + Math.abs(t.amount), 0);
    const potentialDeductions = mockTransactions.filter(t => 
      !t.is_deductible && (
        t.category?.includes('Software') ||
        t.category?.includes('Phone') ||
        t.category?.includes('Internet') ||
        t.merchant_name?.includes('Adobe') ||
        t.merchant_name?.includes('Canva') ||
        t.merchant_name?.includes('Zoom')
      )
    );

    const potentialSavings = potentialDeductions.reduce((sum, t) => sum + (Math.abs(t.amount) * 0.25), 0);

    // Generate profession-specific insights
    const professionInsights = generateProfessionInsights(mockProfile, mockTransactions);
    
    // Generate spending pattern insights
    const spendingPatternInsights = generateSpendingPatternInsights(mockTransactions);
    
    // Combine top opportunities
    const topOpportunities = [...professionInsights, ...spendingPatternInsights]
      .filter(insight => insight.impact === 'high')
      .slice(0, 3);

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

  const generateProfessionInsights = (profile: any, transactions: any[]): AIInsight[] => {
    const insights: AIInsight[] = [];
    const profession = profile?.profession?.[0] || profile?.profession || 'Freelancer';

    // Freelance Designer insights
    if (profession.toLowerCase().includes('design') || profession.toLowerCase().includes('freelance')) {
      insights.push({
        id: 'design-software-deduction',
        title: 'Design Software Deductions',
        description: 'Your Adobe Creative Cloud and Canva subscriptions are 100% deductible as business tools. Track all design-related software expenses.',
        category: 'deduction',
        impact: 'high',
        difficulty: 'easy',
        estimatedSavings: 780, // $52.99/month * 12 * 0.25 tax rate
        icon: <FileText className="w-5 h-5" />,
        actionable: true,
        actionText: 'Mark as Business Expense',
        actionUrl: '/protected/transactions'
      });

      insights.push({
        id: 'home-office-setup',
        title: 'Home Office Deduction',
        description: 'Since you work from home, you can deduct a portion of your rent/mortgage, utilities, and internet. Use the simplified method ($5/sq ft) or actual expenses.',
        category: 'deduction',
        impact: 'high',
        difficulty: 'medium',
        estimatedSavings: 750, // 150 sq ft * $5 * 12 months
        icon: <Home className="w-5 h-5" />,
        actionable: true,
        actionText: 'Set Up Home Office',
        actionUrl: '/protected/settings'
      });

      insights.push({
        id: 'phone-bill-deduction',
        title: 'Business Phone Usage',
        description: 'If you use your phone for client calls and business emails, you can deduct a percentage of your phone bill as a business expense.',
        category: 'deduction',
        impact: 'medium',
        difficulty: 'easy',
        estimatedSavings: 270, // $90/month * 0.25 tax rate
        icon: <Phone className="w-5 h-5" />,
        actionable: true,
        actionText: 'Track Phone Usage',
        actionUrl: '/protected/transactions'
      });
    }

    // Uber/Lyft driver insights
    if (profession.toLowerCase().includes('uber') || profession.toLowerCase().includes('lyft') || profession.toLowerCase().includes('driver')) {
      insights.push({
        id: 'mileage-deduction',
        title: 'Mileage Tracking',
        description: 'Track your business miles for rideshare driving. At $0.67/mile, this can save you thousands compared to actual expenses.',
        category: 'deduction',
        impact: 'high',
        difficulty: 'easy',
        estimatedSavings: 2000,
        icon: <Car className="w-5 h-5" />,
        actionable: true,
        actionText: 'Start Mileage Log',
        actionUrl: '/protected/transactions'
      });

      insights.push({
        id: 'quarterly-taxes',
        title: 'Quarterly Tax Payments',
        description: 'Set aside 25-30% of your income for quarterly tax payments to avoid IRS penalties. Automate this to stay compliant.',
        category: 'planning',
        impact: 'high',
        difficulty: 'medium',
        icon: <Calculator className="w-5 h-5" />,
        actionable: true,
        actionText: 'Set Up Payments',
        actionUrl: '/protected/settings'
      });
    }

    // General freelancer insights
    insights.push({
      id: 'business-expenses',
      title: 'Business Expense Tracking',
      description: 'Keep receipts for all business-related expenses. Software subscriptions, equipment, and professional development are deductible.',
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

  const generateSpendingPatternInsights = (transactions: any[]): AIInsight[] => {
    const insights: AIInsight[] = [];
    
    // Analyze recurring subscriptions
    const subscriptions = transactions.filter(t => 
      t.category?.includes('Software') || 
      t.category?.includes('Subscription') ||
      t.merchant_name?.includes('Adobe') ||
      t.merchant_name?.includes('Canva') ||
      t.merchant_name?.includes('Zoom')
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

    // Analyze meal expenses
    const meals = transactions.filter(t => 
      t.category?.includes('Meals') || 
      t.category?.includes('Food') ||
      t.merchant_name?.includes('Starbucks') ||
      t.merchant_name?.includes('Restaurant')
    );

    if (meals.length > 0) {
      insights.push({
        id: 'meal-deduction-rules',
        title: 'Meal Deduction Rules',
        description: 'Business meals are only 50% deductible. Keep detailed records of who you met with and the business purpose.',
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
      case 'high': return 'bg-red-100 text-red-800 border-red-200';
      case 'medium': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'low': return 'bg-green-100 text-green-800 border-green-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const getCategoryColor = (category: string) => {
    switch (category) {
      case 'deduction': return 'bg-blue-50 border-blue-200';
      case 'planning': return 'bg-purple-50 border-purple-200';
      case 'optimization': return 'bg-green-50 border-green-200';
      case 'warning': return 'bg-orange-50 border-orange-200';
      default: return 'bg-gray-50 border-gray-200';
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-muted flex items-center justify-center">
        <div className="text-center">
          <RefreshCw className="w-8 h-8 animate-spin text-primary mx-auto mb-4" />
          <p className="text-muted-foreground">Analyzing your financial patterns...</p>
        </div>
      </div>
    );
  }

  if (!insights) {
    return (
      <div className="min-h-screen bg-muted flex items-center justify-center">
        <div className="text-center">
          <AlertCircle className="w-8 h-8 text-orange-500 mx-auto mb-4" />
          <p className="text-muted-foreground">Unable to generate insights. Please try again.</p>
          <Button onClick={onBack} className="mt-4">Go Back</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted">
      {/* Header */}
      <div className="bg-white border-b border-border sticky top-0 z-50 shadow-sm">
        <div className="flex items-center justify-between p-6">
          <div className="flex items-center gap-4">
            <Button
              onClick={onBack}
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-foreground"
            >
              ← Back
            </Button>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">AI Tax Insights</h1>
              <p className="text-gray-600">Personalized tax-saving opportunities</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Lightbulb className="w-6 h-6 text-primary" />
            <span className="text-sm text-muted-foreground">
              {userProfile?.profession?.[0] || 'Freelancer'}
            </span>
          </div>
        </div>
      </div>

      <div className="p-6 max-w-6xl mx-auto">
        {/* Summary Banner */}
        <Card className="p-6 bg-gradient-to-r from-primary/5 to-primary/10 border-primary/20 mb-8">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-xl font-semibold text-gray-900 mb-2">
                Your Top 3 Tax-Saving Opportunities This Month
              </h2>
              <p className="text-gray-600">
                Based on your {userProfile?.profession?.[0] || 'freelance'} profession and spending patterns
              </p>
            </div>
            <div className="text-right">
              <div className="text-2xl font-bold text-primary">
                ${insights.monthlySummary.potentialSavings.toFixed(0)}
              </div>
              <div className="text-sm text-muted-foreground">Potential Annual Savings</div>
            </div>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="text-center">
              <div className="text-lg font-semibold text-gray-900">
                {insights.monthlySummary.confirmedDeductions}
              </div>
              <div className="text-sm text-muted-foreground">Confirmed Deductions</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-semibold text-gray-900">
                {insights.monthlySummary.identifiedDeductions}
              </div>
              <div className="text-sm text-muted-foreground">New Opportunities</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-semibold text-gray-900">
                ${insights.monthlySummary.totalDeductions.toFixed(0)}
              </div>
              <div className="text-sm text-muted-foreground">Current Deductions</div>
            </div>
          </div>
        </Card>

        {/* Tab Navigation */}
        <div className="flex space-x-1 mb-6 bg-white rounded-lg p-1 w-fit">
          {[
            { id: 'overview', label: 'Overview', icon: <Target className="w-4 h-4" /> },
            { id: 'deductions', label: 'Deductions', icon: <DollarSign className="w-4 h-4" /> },
            { id: 'planning', label: 'Planning', icon: <Calculator className="w-4 h-4" /> },
            { id: 'patterns', label: 'Patterns', icon: <TrendingUp className="w-4 h-4" /> }
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2 whitespace-nowrap ${
                activeTab === tab.id
                  ? 'bg-primary text-white shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
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
            <h3 className="text-xl font-semibold text-gray-900 mb-4">Top Opportunities</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {insights.topOpportunities.map((insight) => (
                <Card key={insight.id} className={`p-6 border-2 transition-all hover:shadow-lg ${getCategoryColor(insight.category)}`}>
                  <div className="flex items-start gap-4">
                    <div className="p-2 bg-white rounded-lg shadow-sm">
                      {insight.icon}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <h4 className="font-semibold text-gray-900">{insight.title}</h4>
                        <Badge className={`text-xs ${getImpactColor(insight.impact)}`}>
                          {insight.impact.toUpperCase()} IMPACT
                        </Badge>
                      </div>
                      <p className="text-sm text-gray-600 mb-4">{insight.description}</p>
                      {insight.estimatedSavings && (
                        <div className="text-lg font-semibold text-primary mb-4">
                          Save up to ${insight.estimatedSavings}/year
                        </div>
                      )}
                      {insight.actionable && insight.actionText && (
                        <Button size="sm" variant="outline" className="w-full">
                          {insight.actionText}
                          <ArrowRight className="w-4 h-4 ml-2" />
                        </Button>
                      )}
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'deductions' && (
          <div className="space-y-6">
            <h3 className="text-xl font-semibold text-gray-900 mb-4">Deduction Opportunities</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {insights.professionInsights.filter(i => i.category === 'deduction').map((insight) => (
                <Card key={insight.id} className={`p-6 border-2 transition-all hover:shadow-lg ${getCategoryColor(insight.category)}`}>
                  <div className="flex items-start gap-4">
                    <div className="p-2 bg-white rounded-lg shadow-sm">
                      {insight.icon}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <h4 className="font-semibold text-gray-900">{insight.title}</h4>
                        <Badge className={`text-xs ${getImpactColor(insight.impact)}`}>
                          {insight.impact.toUpperCase()}
                        </Badge>
                      </div>
                      <p className="text-sm text-gray-600 mb-4">{insight.description}</p>
                      {insight.estimatedSavings && (
                        <div className="text-lg font-semibold text-primary mb-4">
                          Save up to ${insight.estimatedSavings}/year
                        </div>
                      )}
                      {insight.actionable && insight.actionText && (
                        <Button size="sm" variant="outline" className="w-full">
                          {insight.actionText}
                          <ArrowRight className="w-4 h-4 ml-2" />
                        </Button>
                      )}
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'planning' && (
          <div className="space-y-6">
            <h3 className="text-xl font-semibold text-gray-900 mb-4">Tax Planning</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {insights.professionInsights.filter(i => i.category === 'planning').map((insight) => (
                <Card key={insight.id} className={`p-6 border-2 transition-all hover:shadow-lg ${getCategoryColor(insight.category)}`}>
                  <div className="flex items-start gap-4">
                    <div className="p-2 bg-white rounded-lg shadow-sm">
                      {insight.icon}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <h4 className="font-semibold text-gray-900">{insight.title}</h4>
                        <Badge className={`text-xs ${getImpactColor(insight.impact)}`}>
                          {insight.impact.toUpperCase()}
                        </Badge>
                      </div>
                      <p className="text-sm text-gray-600 mb-4">{insight.description}</p>
                      {insight.estimatedSavings && (
                        <div className="text-lg font-semibold text-primary mb-4">
                          Save up to ${insight.estimatedSavings}/year
                        </div>
                      )}
                      {insight.actionable && insight.actionText && (
                        <Button size="sm" variant="outline" className="w-full">
                          {insight.actionText}
                          <ArrowRight className="w-4 h-4 ml-2" />
                        </Button>
                      )}
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'patterns' && (
          <div className="space-y-6">
            <h3 className="text-xl font-semibold text-gray-900 mb-4">Spending Pattern Insights</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {insights.spendingPatternInsights.map((insight) => (
                <Card key={insight.id} className={`p-6 border-2 transition-all hover:shadow-lg ${getCategoryColor(insight.category)}`}>
                  <div className="flex items-start gap-4">
                    <div className="p-2 bg-white rounded-lg shadow-sm">
                      {insight.icon}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <h4 className="font-semibold text-gray-900">{insight.title}</h4>
                        <Badge className={`text-xs ${getImpactColor(insight.impact)}`}>
                          {insight.impact.toUpperCase()}
                        </Badge>
                      </div>
                      <p className="text-sm text-gray-600 mb-4">{insight.description}</p>
                      {insight.estimatedSavings && (
                        <div className="text-lg font-semibold text-primary mb-4">
                          Save up to ${insight.estimatedSavings}/year
                        </div>
                      )}
                      {insight.actionable && insight.actionText && (
                        <Button size="sm" variant="outline" className="w-full">
                          {insight.actionText}
                          <ArrowRight className="w-4 h-4 ml-2" />
                        </Button>
                      )}
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
