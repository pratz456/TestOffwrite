'use client';

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { 
  Plus, 
  Camera, 
  FileText, 
  TrendingUp,
  Receipt,
  Car,
  Home,
  Briefcase,
  Calculator
} from 'lucide-react';

interface MobileQuickActionsProps {
  onNavigate: (screen: string) => void;
  onAddExpense: () => void;
  onTakePhoto: () => void;
  isVisible: boolean;
}

export function MobileQuickActions({ 
  onNavigate, 
  onAddExpense, 
  onTakePhoto,
  isVisible 
}: MobileQuickActionsProps) {
  const [isInstalled, setIsInstalled] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);

  useEffect(() => {
    // Check if app is already installed
    if (window.matchMedia('(display-mode: standalone)').matches) {
      setIsInstalled(true);
    }

    // Listen for beforeinstallprompt event
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);

  const handleInstallClick = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        setDeferredPrompt(null);
        setIsInstalled(true);
      }
    }
  };

  if (!isVisible) return null;

  const quickActions = [
    {
      id: 'add-expense',
      label: 'Add Expense',
      icon: Plus,
      action: onAddExpense,
      color: 'bg-teal-500 hover:bg-teal-600',
      description: 'Quick expense entry'
    },
    {
      id: 'camera',
      label: 'Scan Receipt',
      icon: Camera,
      action: onTakePhoto,
      color: 'bg-blue-500 hover:bg-blue-600',
      description: 'Photo to expense'
    },
    {
      id: 'insights',
      label: 'AI Insights',
      icon: TrendingUp,
      action: () => onNavigate('ai-insights'),
      color: 'bg-orange-500 hover:bg-orange-600',
      description: 'Tax optimization'
    }
  ];

  const categoryActions = [
    {
      id: 'receipts',
      label: 'Receipts',
      icon: Receipt,
      action: () => onNavigate('receipts'),
      color: 'bg-green-100 text-green-700 hover:bg-green-200'
    },
    {
      id: 'mileage',
      label: 'Mileage',
      icon: Car,
      action: () => onNavigate('mileage'),
      color: 'bg-blue-100 text-blue-700 hover:bg-blue-200'
    },
    {
      id: 'home-office',
      label: 'Home Office',
      icon: Home,
      action: () => onNavigate('home-office'),
      color: 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200'
    },
    {
      id: 'business',
      label: 'Business',
      icon: Briefcase,
      action: () => onNavigate('business'),
      color: 'bg-purple-100 text-purple-700 hover:bg-purple-200'
    }
  ];

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 p-4 pb-safe">
      {/* Install Prompt */}
      {!isInstalled && deferredPrompt && (
        <Card className="mb-4 bg-gradient-to-r from-teal-50 to-blue-50 border-teal-200">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-teal-900">Install WriteOff</h3>
                <p className="text-sm text-teal-700">Get quick access from your home screen</p>
              </div>
              <Button 
                onClick={handleInstallClick}
                className="bg-teal-600 hover:bg-teal-700"
                size="sm"
              >
                Install
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Quick Actions Grid */}
      <div className="grid grid-cols-4 gap-3 mb-4">
        {quickActions.map((action) => {
          const IconComponent = action.icon;
          return (
            <Button
              key={action.id}
              onClick={action.action}
              className={`${action.color} text-white h-16 flex flex-col items-center justify-center gap-1 rounded-xl`}
              variant="default"
            >
              <IconComponent className="h-6 w-6" />
              <span className="text-xs font-medium">{action.label}</span>
            </Button>
          );
        })}
      </div>

      {/* Category Actions */}
      <div className="grid grid-cols-4 gap-2">
        {categoryActions.map((action) => {
          const IconComponent = action.icon;
          return (
            <Button
              key={action.id}
              onClick={action.action}
              className={`${action.color} h-12 flex flex-col items-center justify-center gap-1 rounded-lg`}
              variant="ghost"
            >
              <IconComponent className="h-4 w-4" />
              <span className="text-xs">{action.label}</span>
            </Button>
          );
        })}
      </div>

      {/* Floating Action Button for Calculator */}
      <Button
        onClick={() => onNavigate('calculator')}
        className="fixed bottom-20 right-4 bg-teal-600 hover:bg-teal-700 text-white rounded-full w-14 h-14 shadow-lg"
        size="icon"
      >
        <Calculator className="h-6 w-6" />
      </Button>
    </div>
  );
}
