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
          className="border-gray-300 hover:bg-gray-50"
          disabled={disabled}
        >
          <FileText className="w-4 h-4 mr-2" />
          Generate Other Reports
          <ChevronDown className="w-4 h-4 ml-2" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-80" align="end">
        {Object.entries(formConfig).map(([formType, config]) => {
          const Icon = config.icon;
          
          return (
            <DropdownMenuItem
              key={formType}
              onClick={() => handleFormGeneration(formType as FormType)}
              disabled={disabled}
              className="flex items-start gap-3 p-3 cursor-pointer"
            >
              <div className="flex-shrink-0 mt-0.5">
                <Icon className="w-4 h-4 text-gray-600" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm text-gray-900">
                  {config.label}
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  {config.description}
                </div>
              </div>
            </DropdownMenuItem>
          );
        })}
        
        <DropdownMenuSeparator />
        
        <div className="px-3 py-2">
          <div className="text-xs text-gray-500">
            All forms are generated based on your transaction data and settings.
            Missing information will be highlighted during generation.
          </div>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
