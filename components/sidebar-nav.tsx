"use client";

import React, { useState, useEffect } from 'react';
import { LogoutButton } from './logout-button';
import { useSubscription } from '@/lib/hooks/use-subscription';
import { premiumFeatureForLocation } from '@/lib/subscriptions/client-status';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { PRIMARY_NAVIGATION, RECORD_NAVIGATION, TAX_TOOL_NAVIGATION, ACCOUNT_NAVIGATION, navigationItemActive, type AppNavigationItem } from '@/lib/navigation/app-navigation';
import { requestAppNavigation } from '@/lib/navigation/navigation-guard';
interface SidebarNavProps {
  user: { id: string; email?: string; user_metadata?: { name?: string } };
  userProfile?: { name?: string; email?: string };
}

export const SidebarNav: React.FC<SidebarNavProps> = ({ user, userProfile }) => {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { canAccess, isLoading: planLoading, error: planError } = useSubscription();
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const mainItems = PRIMARY_NAVIGATION;
  const advancedItems = TAX_TOOL_NAVIGATION;
  const isActive = (href: string) => navigationItemActive(href, pathname, searchParams.get('screen'));

  // Auto-open advanced section if any advanced item is active
  useEffect(() => {
    const anyAdvancedActive = TAX_TOOL_NAVIGATION.some((item) => navigationItemActive(item.href, pathname, searchParams.get('screen')));
    if (anyAdvancedActive) {
      setAdvancedOpen(true);
    }
  }, [pathname, searchParams]);

  const renderNavItem = (item: AppNavigationItem) => {
    const Icon = item.icon;
    const active = isActive(item.href);
    const [itemPath, query] = item.href.split('?');
    const feature = premiumFeatureForLocation(itemPath, new URLSearchParams(query).get('screen'));
    const locked = feature && !planLoading && !planError && !canAccess(feature);

    const baseClasses = 'flex items-center gap-2.5 px-3 py-2.5 min-h-11 rounded-lg transition-colors duration-150 group w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 text-sm';
    const activeClasses = active
      ? 'bg-muted/60 text-foreground border-l-2 border-primary pl-2'
      : 'text-muted-foreground hover:bg-muted/40 hover:text-foreground';
    const iconClasses = active ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground';


    return (
      <Link
        key={item.name}
        href={item.href}
        onClick={event => {
          if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && !requestAppNavigation(item.href)) event.preventDefault();
        }}
        className={`${baseClasses} ${activeClasses}`}
        aria-current={active ? 'page' : undefined}
      >
        <Icon className={`w-4 h-4 shrink-0 ${iconClasses}`} />
        <span className="font-medium truncate">{item.name}</span>{locked && <span className="ml-auto text-xs text-muted-foreground">Premium</span>}
      </Link>
    );
  };

  return (
    <div className="hidden lg:flex w-60 bg-card border-r border-border/50 h-dvh flex-col">
      {/* Logo/Brand */}
      <div className="px-4 py-3 border-b border-border/50">
        <div className="flex items-center gap-2">
          <img src="/writeofflogo.png" alt="WriteOff" className="w-6 h-6 rounded-md" />
          <div>
            <h1 className="text-sm font-semibold text-foreground">WriteOff</h1>
            <p className="text-xs text-muted-foreground leading-none">Effortless Tax</p>
          </div>
        </div>
      </div>

      {/* Navigation Items */}
      <nav className="flex-1 px-2 py-2 space-y-0.5 overflow-y-auto" aria-label="Main navigation">
        {/* Main Items */}
        {mainItems.map((item) => renderNavItem(item))}

        <div className="mt-3 border-t border-border/60 pt-3">
          <p className="px-3 pb-1 text-xs font-medium text-muted-foreground">Your records</p>
          {RECORD_NAVIGATION.map(item => renderNavItem(item))}
        </div>

        {/* Additional tax tools */}
        <div className="pt-2 mt-2 border-t border-border/40">
          <button
            onClick={() => setAdvancedOpen(!advancedOpen)}
            className="flex items-center justify-between w-full px-3 py-2.5 min-h-11 rounded-lg text-sm text-muted-foreground hover:bg-muted/40 hover:text-foreground transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            aria-expanded={advancedOpen}
          >
            <span className="font-medium text-xs uppercase tracking-wider">Tax tools</span>
            {advancedOpen ? (
              <ChevronUp className="w-4 h-4 shrink-0" />
            ) : (
              <ChevronDown className="w-4 h-4 shrink-0" />
            )}
          </button>
          {advancedOpen && <div className="pl-2 space-y-0.5 pt-0.5">
            {advancedItems.map(item => renderNavItem(item))}
          </div>}
        </div>

        {/* Bottom Items */}
        <div className="pt-2 mt-2 border-t border-border/40">
          {ACCOUNT_NAVIGATION.map(item => renderNavItem(item))}
        </div>
      </nav>

      {/* User Info and Sign Out */}
      <div className="border-t border-border/50">
        <div className="px-3 py-2.5">
          <div className="flex items-center gap-2 w-full">
            <div className="w-7 h-7 bg-muted rounded-full flex items-center justify-center shrink-0">
              <span className="text-muted-foreground font-medium text-xs">
                {userProfile?.name?.charAt(0) || user.user_metadata?.name?.charAt(0) || user.email?.charAt(0) || 'U'}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-foreground truncate">
                {userProfile?.name || user.user_metadata?.name || 'User'}
              </p>
              <p className="text-xs text-muted-foreground truncate">
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
