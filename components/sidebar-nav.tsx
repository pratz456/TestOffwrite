"use client";

import React, { useState, useEffect } from 'react';
import { LogoutButton } from './logout-button';
import Link from 'next/link';
import { usePathname, useSearchParams, useRouter } from 'next/navigation';
import { Home, CreditCard, BarChart3, Settings, TrendingUp, ClipboardCheck, Eye, Minus, Sparkles, ChevronDown, ChevronUp, Briefcase, PenLine, FolderOpen, Calculator } from 'lucide-react';
interface SidebarNavProps {
  user: { id: string; email?: string; user_metadata?: { name?: string } };
  userProfile?: { name?: string; email?: string };
}

export const SidebarNav: React.FC<SidebarNavProps> = ({ user, userProfile }) => {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const mainItems = [
    {
      name: 'Home',
      href: '/protected',
      icon: Home,
      description: 'Dashboard overview',
      isHome: true
    },
    {
      name: 'Transactions',
      href: '/protected/transactions',
      icon: CreditCard,
      description: 'View and manage transactions'
    },
    {
      name: 'Income',
      href: '/protected?screen=income-tracking',
      icon: TrendingUp,
      description: 'Track income & 1099 forms'
    },
    {
      name: 'Deductions',
      href: '/protected?screen=deductions-entry',
      icon: Minus,
      description: 'Health insurance, retirement, HSA'
    },
    {
      name: 'Categories',
      href: '/protected?screen=categories',
      icon: FolderOpen,
      description: 'Expense categories & rules'
    },
    {
      name: 'File Taxes',
      href: '/protected?screen=tax-filing-hub',
      icon: ClipboardCheck,
      description: 'Filing hub & form exports'
    },
  ];

  const advancedItems = [
    {
      name: 'Tax Preview',
      href: '/protected?screen=tax-preview',
      icon: Eye,
      description: 'Live balance due or refund'
    },
    {
      name: 'W-2 Income',
      href: '/protected?screen=w2-income',
      icon: Briefcase,
      description: 'Enter W-2 wages from employers'
    },
    {
      name: 'Form 8879 Consent',
      href: '/protected?screen=form-8879',
      icon: PenLine,
      description: 'PIN storage for later partner filing'
    },
    {
      name: 'Reports',
      href: '/protected/reports',
      icon: BarChart3,
      description: 'Tax reports and analytics'
    },
    {
      name: 'Depreciation (4562)',
      href: '/protected/form4562',
      icon: Calculator,
      description: 'Section 179 & MACRS assets'
    },
    {
      name: 'AI Tax Assistant',
      href: '/protected?screen=tax-assistant',
      icon: Sparkles,
      description: 'Ask tax questions'
    },
  ];

  const isActive = (href: string) => {
    if (href === '/protected') {
      return pathname === '/protected' && !searchParams.has('screen');
    }
    // Handle all ?screen= routes generically
    if (href.startsWith('/protected?screen=')) {
      const screen = href.split('screen=')[1];
      return pathname === '/protected' && searchParams.get('screen') === screen;
    }
    // For Settings, check if we're on the settings page
    if (href === '/protected/settings') {
      return pathname === '/protected/settings';
    }

    // For other pages, check if the pathname starts with the href
    return pathname.startsWith(href);
  };

  // Auto-open advanced section if any advanced item is active
  useEffect(() => {
    const anyAdvancedActive = advancedItems.some((item) => isActive(item.href));
    if (anyAdvancedActive) {
      setAdvancedOpen(true);
    }
  }, [pathname, searchParams]);

  const renderNavItem = (item: typeof mainItems[0]) => {
    const Icon = item.icon;
    const active = isActive(item.href);

    const baseClasses = 'flex items-center gap-2.5 px-2.5 py-1.5 rounded-md transition-colors duration-150 group w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 text-sm';
    const activeClasses = active
      ? 'bg-muted/60 text-foreground border-l-2 border-primary pl-2'
      : 'text-muted-foreground hover:bg-muted/40 hover:text-foreground';
    const iconClasses = active ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground';

    if (item.isHome) {
      return (
        <button
          key={item.name}
          onClick={() => router.push('/protected')}
          className={`${baseClasses} ${activeClasses}`}
          aria-current={active ? 'page' : undefined}
        >
          <Icon className={`w-4 h-4 shrink-0 ${iconClasses}`} />
          <span className="font-medium truncate">{item.name}</span>
        </button>
      );
    }

    return (
      <Link
        key={item.name}
        href={item.href}
        className={`${baseClasses} ${activeClasses}`}
        aria-current={active ? 'page' : undefined}
      >
        <Icon className={`w-4 h-4 shrink-0 ${iconClasses}`} />
        <span className="font-medium truncate">{item.name}</span>
      </Link>
    );
  };

  return (
    <div className="hidden lg:flex w-60 bg-card border-r border-border/50 h-screen flex-col">
      {/* Logo/Brand */}
      <div className="px-4 py-3 border-b border-border/50">
        <div className="flex items-center gap-2">
          <img src="/writeofflogo.png" alt="WriteOff" className="w-6 h-6 rounded-md" />
          <div>
            <h1 className="text-sm font-semibold text-foreground">WriteOff</h1>
            <p className="text-[10px] text-muted-foreground leading-none">Effortless Tax</p>
          </div>
        </div>
      </div>

      {/* Navigation Items */}
      <nav className="flex-1 px-2 py-2 space-y-0.5 overflow-y-auto" aria-label="Main navigation">
        {/* Main Items */}
        {mainItems.map((item) => renderNavItem(item))}

        {/* Advanced Taxes Collapsible Section */}
        <div className="pt-2 mt-2 border-t border-border/40">
          <button
            onClick={() => setAdvancedOpen(!advancedOpen)}
            className="flex items-center justify-between w-full px-2.5 py-1.5 rounded-md text-sm text-muted-foreground hover:bg-muted/40 hover:text-foreground transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            aria-expanded={advancedOpen}
          >
            <span className="font-medium text-xs uppercase tracking-wider">Advanced Taxes</span>
            {advancedOpen ? (
              <ChevronUp className="w-4 h-4 shrink-0" />
            ) : (
              <ChevronDown className="w-4 h-4 shrink-0" />
            )}
          </button>
          <div
            className="overflow-hidden transition-[max-height,opacity] duration-300 ease-in-out"
            style={{
              maxHeight: advancedOpen ? `${advancedItems.length * 40}px` : '0px',
              opacity: advancedOpen ? 1 : 0,
            }}
          >
            <div className="pl-2 space-y-0.5 pt-0.5">
              {advancedItems.map((item) => renderNavItem(item))}
            </div>
          </div>
        </div>

        {/* Bottom Items */}
        <div className="pt-2 mt-2 border-t border-border/40">
          {renderNavItem({
            name: 'Settings',
            href: '/protected/settings',
            icon: Settings,
            description: 'Account and preferences'
          })}
        </div>
      </nav>

      {/* User Info and Sign Out */}
      <div className="border-t border-border/50">
        <div className="px-3 py-2.5">
          <div className="flex items-center gap-2 w-full">
            <div className="w-7 h-7 bg-muted rounded-full flex items-center justify-center shrink-0">
              <span className="text-muted-foreground font-medium text-[10px]">
                {userProfile?.name?.charAt(0) || user.user_metadata?.name?.charAt(0) || user.email?.charAt(0) || 'U'}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-foreground truncate">
                {userProfile?.name || user.user_metadata?.name || 'User'}
              </p>
              <p className="text-[10px] text-muted-foreground truncate">
                {userProfile?.email || user.email}
              </p>
            </div>
          </div>
        </div>
        <div className="px-3 pb-3">
          <LogoutButton
            className="w-full border border-destructive/20 text-destructive bg-card hover:bg-destructive/10 hover:text-destructive text-xs font-medium py-1.5 rounded-md transition-colors duration-150 flex items-center justify-center gap-1.5"
            icon={true}
          />
        </div>
      </div>
    </div>
  );
};
