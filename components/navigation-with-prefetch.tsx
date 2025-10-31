"use client";

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/firebase/auth-context';
import { 
  usePrefetchTransactions, 
  usePrefetchAccounts, 
  usePrefetchMonthlyDeductions 
} from '@/lib/react-query/hooks';
import { 
  Home, 
  CreditCard, 
  BarChart3, 
  Settings, 
  LogOut,
  TrendingUp,
  FileText
} from 'lucide-react';

export function NavigationWithPrefetch() {
  const { user, signOut } = useAuth();
  const router = useRouter();
  
  // Prefetch hooks
  const prefetchTransactions = usePrefetchTransactions(user?.id || '');
  const prefetchAccounts = usePrefetchAccounts(user?.id || '');
  const prefetchMonthlyDeductions = usePrefetchMonthlyDeductions(user?.id || '');

  const navigationItems = [
    {
      href: '/protected',
      label: 'Dashboard',
      icon: Home,
      prefetch: () => {
        prefetchTransactions();
        prefetchAccounts();
      }
    },
    {
      href: '/protected/transactions',
      label: 'Transactions',
      icon: CreditCard,
      prefetch: () => {
        prefetchTransactions();
      }
    },
    {
      href: '/protected/reports',
      label: 'Reports',
      icon: BarChart3,
      prefetch: () => {
        prefetchMonthlyDeductions();
        prefetchTransactions();
      }
    },
    {
      href: '/protected/settings',
      label: 'Settings',
      icon: Settings,
      prefetch: () => {
        // Settings page doesn't need specific prefetching
      }
    }
  ];

  const handleSignOut = async () => {
    try {
      await signOut();
      router.push('/');
    } catch (error) {
      console.error('Error signing out:', error);
    }
  };

  return (
    <nav className="bg-white border-r border-gray-200 w-64 min-h-screen p-4">
      <div className="flex flex-col h-full">
        {/* Logo/Brand */}
        <div className="flex items-center mb-8">
          <TrendingUp className="w-8 h-8 text-blue-600 mr-2" />
          <h1 className="text-xl font-bold text-gray-900">WriteOff</h1>
        </div>

        {/* Navigation Items */}
        <div className="flex-1 space-y-2">
          {navigationItems.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className="flex items-center px-3 py-2 text-gray-700 rounded-md hover:bg-gray-100 hover:text-gray-900 transition-colors"
                onMouseEnter={() => {
                  // Prefetch data on hover for faster navigation
                  item.prefetch();
                }}
                onClick={() => {
                  // Also prefetch on click for immediate feedback
                  item.prefetch();
                }}
              >
                <Icon className="w-5 h-5 mr-3" />
                {item.label}
              </Link>
            );
          })}
        </div>

        {/* User Info and Sign Out */}
        <div className="border-t border-gray-200 pt-4">
          {user && (
            <div className="mb-4">
              <p className="text-sm text-gray-600 truncate">{user.email}</p>
            </div>
          )}
          <button
            onClick={handleSignOut}
            className="flex items-center w-full px-3 py-2 text-gray-700 rounded-md hover:bg-gray-100 hover:text-gray-900 transition-colors"
          >
            <LogOut className="w-5 h-5 mr-3" />
            Sign Out
          </button>
        </div>
      </div>
    </nav>
  );
}

// Quick action buttons for common tasks
export function QuickActions() {
  const { user } = useAuth();
  const prefetchTransactions = usePrefetchTransactions(user?.id || '');
  const prefetchMonthlyDeductions = usePrefetchMonthlyDeductions(user?.id || '');

  return (
    <div className="flex space-x-2 mb-6">
      <Link
        href="/protected/transactions"
        className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
        onMouseEnter={prefetchTransactions}
      >
        <CreditCard className="w-4 h-4 mr-2" />
        View Transactions
      </Link>
      
      <Link
        href="/protected/reports"
        className="flex items-center px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors"
        onMouseEnter={() => {
          prefetchMonthlyDeductions();
          prefetchTransactions();
        }}
      >
        <FileText className="w-4 h-4 mr-2" />
        View Reports
      </Link>
    </div>
  );
}
