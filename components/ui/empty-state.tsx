'use client';

import React from 'react';
import { Button } from './button';
import { 
  CreditCard, 
  FolderOpen, 
  Receipt, 
  TrendingUp, 
  Plus,
  Upload,
  Search
} from 'lucide-react';

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description: string;
  action?: {
    label: string;
    onClick: () => void;
    variant?: 'default' | 'outline' | 'secondary';
  };
  secondaryAction?: {
    label: string;
    onClick: () => void;
  };
  className?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  description,
  action,
  secondaryAction,
  className = ''
}) => {
  return (
    <div className={`flex flex-col items-center justify-center py-12 px-4 text-center ${className}`}>
      <div className="mb-4 text-gray-400">
        {icon}
      </div>
      
      <h3 className="text-lg font-semibold text-gray-900 mb-2">
        {title}
      </h3>
      
      <p className="text-gray-600 mb-6 max-w-md">
        {description}
      </p>
      
      <div className="flex flex-col sm:flex-row gap-3">
        {action && (
          <Button
            onClick={action.onClick}
            variant={action.variant || 'default'}
            className="flex items-center gap-2"
          >
            {action.label}
          </Button>
        )}
        
        {secondaryAction && (
          <Button
            onClick={secondaryAction.onClick}
            variant="outline"
            className="flex items-center gap-2"
          >
            {secondaryAction.label}
          </Button>
        )}
      </div>
    </div>
  );
};

// Pre-configured empty states for common use cases
export const EmptyTransactionsState: React.FC<{
  onConnectBank?: () => void;
  onAddExpense?: () => void;
}> = ({ onConnectBank, onAddExpense }) => (
  <EmptyState
    icon={<CreditCard className="w-12 h-12" />}
    title="No transactions yet"
    description="Connect your bank account to automatically import transactions, or add expenses manually to get started with tax deductions."
    action={onConnectBank ? {
      label: 'Connect Bank Account',
      onClick: onConnectBank,
      variant: 'default'
    } : undefined}
    secondaryAction={onAddExpense ? {
      label: 'Add Expense Manually',
      onClick: onAddExpense
    } : undefined}
  />
);

export const EmptyCategoriesState: React.FC<{
  onAddExpense?: () => void;
}> = ({ onAddExpense }) => (
  <EmptyState
    icon={<FolderOpen className="w-12 h-12" />}
    title="No expense categories"
    description="Categorize your transactions to track tax deductions by category and see where your money is going."
    action={onAddExpense ? {
      label: 'Add First Expense',
      onClick: onAddExpense,
      variant: 'default'
    } : undefined}
  />
);

export const EmptyReceiptsState: React.FC<{
  onUploadReceipt?: () => void;
}> = ({ onUploadReceipt }) => (
  <EmptyState
    icon={<Receipt className="w-12 h-12" />}
    title="No receipts uploaded"
    description="Upload receipts to support your tax deductions and keep organized records for tax season."
    action={onUploadReceipt ? {
      label: 'Upload Receipt',
      onClick: onUploadReceipt,
      variant: 'default'
    } : undefined}
  />
);

export const EmptyReportsState: React.FC<{
  onConnectBank?: () => void;
}> = ({ onConnectBank }) => (
  <EmptyState
    icon={<TrendingUp className="w-12 h-12" />}
    title="No reports available"
    description="Connect your bank account and categorize transactions to generate tax reports and see your deduction savings."
    action={onConnectBank ? {
      label: 'Connect Bank Account',
      onClick: onConnectBank,
      variant: 'default'
    } : undefined}
  />
);

export const EmptySearchState: React.FC<{
  searchTerm?: string;
  onClearSearch?: () => void;
}> = ({ searchTerm, onClearSearch }) => (
  <EmptyState
    icon={<Search className="w-12 h-12" />}
    title={searchTerm ? `No results for "${searchTerm}"` : 'No search results'}
    description={searchTerm 
      ? "Try adjusting your search terms or filters to find what you're looking for."
      : "Enter a search term to find transactions, categories, or other data."
    }
    action={onClearSearch ? {
      label: 'Clear Search',
      onClick: onClearSearch,
      variant: 'outline'
    } : undefined}
  />
);
