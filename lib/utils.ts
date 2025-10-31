import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// This check can be removed, it is just for tutorial purposes
export const hasEnvVars =
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_OR_ANON_KEY;

/**
 * Formats a category name from database format to user-friendly format
 * @param category - The category string from the database (e.g., "GENERAL_SERVICES_ACCOUNTING_AND_FINANCIAL_PLANNING")
 * @returns Formatted category name (e.g., "General Services Accounting And Financial Planning")
 */
export function formatCategory(category: string): string {
  if (!category) return 'Uncategorized';
  return category
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Strategic category consolidation and naming
 * @param category - The original category string from the database
 * @returns Object with consolidatedName and displayName
 */
export function consolidateCategory(category: string): { consolidatedName: string; displayName: string } {
  const categoryLower = category.toLowerCase();
  
  // Food & Drink consolidation
  if (categoryLower.includes('food') || categoryLower.includes('drink') || categoryLower.includes('coffee') || 
      categoryLower.includes('fast_food') || categoryLower.includes('meals')) {
    return {
      consolidatedName: 'FOOD_AND_DRINK',
      displayName: 'Food & Drink'
    };
  }
  
  // Transportation consolidation
  if (categoryLower.includes('transportation') || categoryLower.includes('taxi') || categoryLower.includes('ride') || 
      categoryLower.includes('uber') || categoryLower.includes('lyft')) {
    return {
      consolidatedName: 'TRANSPORTATION',
      displayName: 'Transportation'
    };
  }
  
  // Travel consolidation
  if (categoryLower.includes('travel') || categoryLower.includes('flight') || categoryLower.includes('hotel') || 
      categoryLower.includes('accommodation')) {
    return {
      consolidatedName: 'TRAVEL',
      displayName: 'Travel'
    };
  }
  
  // Entertainment consolidation
  if (categoryLower.includes('entertainment') || categoryLower.includes('sporting') || categoryLower.includes('amusement') || 
      categoryLower.includes('museums') || categoryLower.includes('events')) {
    return {
      consolidatedName: 'ENTERTAINMENT',
      displayName: 'Entertainment'
    };
  }
  
  // Professional Services consolidation
  if (categoryLower.includes('professional') || categoryLower.includes('services') || categoryLower.includes('accounting') || 
      categoryLower.includes('legal') || categoryLower.includes('consulting')) {
    return {
      consolidatedName: 'PROFESSIONAL_SERVICES',
      displayName: 'Professional Services'
    };
  }
  
  // Office & Equipment consolidation
  if (categoryLower.includes('office') || categoryLower.includes('equipment') || categoryLower.includes('supplies') || 
      categoryLower.includes('software') || categoryLower.includes('tools')) {
    return {
      consolidatedName: 'OFFICE_AND_EQUIPMENT',
      displayName: 'Office & Equipment'
    };
  }
  
  // Loan & Financial consolidation
  if (categoryLower.includes('loan') || categoryLower.includes('payment') || categoryLower.includes('credit') || 
      categoryLower.includes('financial') || categoryLower.includes('banking')) {
    return {
      consolidatedName: 'LOAN_AND_FINANCIAL',
      displayName: 'Loan & Financial'
    };
  }
  
  // General Merchandise consolidation
  if (categoryLower.includes('general') || categoryLower.includes('merchandise') || categoryLower.includes('retail') || 
      categoryLower.includes('shopping')) {
    return {
      consolidatedName: 'GENERAL_MERCHANDISE',
      displayName: 'General Merchandise'
    };
  }
  
  // Income consolidation
  if (categoryLower.includes('income') || categoryLower.includes('wages') || categoryLower.includes('salary')) {
    return {
      consolidatedName: 'INCOME',
      displayName: 'Income'
    };
  }
  
  // Default: use formatted original category
  return {
    consolidatedName: category,
    displayName: formatCategory(category)
  };
}
