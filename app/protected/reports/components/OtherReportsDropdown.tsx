"use client";

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ChevronDown, FileText, Home, Calculator, User } from 'lucide-react';

interface OtherReportsDropdownProps {
  disabled?: boolean;
}

type FormType = 'form8829' | 'form4562' | 'scheduleSE';

const formConfig = {
  form8829: {
    label: 'Form 8829 – Home Office Expenses',
    icon: Home,
    description: 'Calculate home office deductions'
  },
  form4562: {
    label: 'Form 4562 – Depreciation & Amortization',
    icon: Calculator,
    description: 'Track asset depreciation and amortization'
  },
  scheduleSE: {
    label: 'Schedule SE – Self-Employment Tax',
    icon: User,
    description: 'Calculate self-employment tax obligations'
  }
};

export function OtherReportsDropdown({ disabled = false }: OtherReportsDropdownProps) {

  const handleFormGeneration = (formType: FormType) => {
    // Navigate to the dedicated form page
    const routes = {
      form8829: '/protected/form8829',
      form4562: '/protected/form4562',
      scheduleSE: '/protected/scheduleSE'
    };
    
    window.location.href = routes[formType];
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button 
          variant="outline" 
          size="sm"
          className="h-10 px-3 sm:px-4 border-2 border-gray-300 dark:border-gray-500 bg-white dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 hover:border-primary/60 dark:hover:border-primary/60 text-gray-700 dark:text-gray-200 transition-all duration-200 no-tap-highlight group"
          disabled={disabled}
        >
          <FileText className="w-4 h-4 group-hover:text-primary transition-colors" />
          <span className="ml-2 text-sm font-medium">Reports</span>
          <ChevronDown className="w-3.5 h-3.5 ml-1.5 opacity-60 group-hover:opacity-100 transition-opacity" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-72 sm:w-80" align="end">
        {Object.entries(formConfig).map(([formType, config]) => {
          const Icon = config.icon;
          
          return (
            <DropdownMenuItem
              key={formType}
              onClick={() => handleFormGeneration(formType as FormType)}
              disabled={disabled}
              className="flex items-start gap-2.5 p-2.5 cursor-pointer"
            >
              <div className="flex-shrink-0 mt-0.5">
                <Icon className="w-4 h-4 text-muted-foreground" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm text-foreground">
                  {config.label}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {config.description}
                </div>
              </div>
            </DropdownMenuItem>
          );
        })}
        
        <DropdownMenuSeparator />
        
        <div className="px-2.5 py-2">
          <div className="text-xs text-muted-foreground">
            Forms generated from your transaction data.
          </div>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
