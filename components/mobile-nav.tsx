'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { usePathname, useSearchParams, useRouter } from 'next/navigation';
import { Menu, X, ChevronDown, ChevronUp } from 'lucide-react';
import { PRIMARY_NAVIGATION, RECORD_NAVIGATION, TAX_TOOL_NAVIGATION, ACCOUNT_NAVIGATION, navigationItemActive, primaryNavigationActive, type AppNavigationItem } from '@/lib/navigation/app-navigation';
import { requestAppNavigation } from '@/lib/navigation/navigation-guard';
import { LogoutButton } from './logout-button';
import { useSubscription } from '@/lib/hooks/use-subscription';
import { premiumFeatureForLocation } from '@/lib/subscriptions/client-status';

interface MobileNavProps {
  user: { id: string; email?: string; user_metadata?: { name?: string } };
  userProfile?: { name?: string; email?: string };
}

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export const MobileNav: React.FC<MobileNavProps> = ({ user, userProfile }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { canAccess, isLoading: planLoading, error: planError } = useSubscription();
  const drawerRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  const mainItems = PRIMARY_NAVIGATION;
  const advancedItems = TAX_TOOL_NAVIGATION;
  const bottomItems = ACCOUNT_NAVIGATION;
  const isActive = (href: string) => navigationItemActive(href, pathname, searchParams.get('screen'));

  // Auto-open advanced section if any advanced item is active
  useEffect(() => {
    const anyAdvancedActive = TAX_TOOL_NAVIGATION.some((item) => navigationItemActive(item.href, pathname, searchParams.get('screen')));
    if (anyAdvancedActive) {
      setAdvancedOpen(true);
    }
  }, [pathname, searchParams]);

  const handleNavClick = (href: string) => {
    setIsOpen(false);
    if (requestAppNavigation(href)) router.push(href);
  };

  // Lock body scroll when menu is open to prevent background scrolling
  useEffect(() => {
    if (isOpen) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = prev;
      };
    }
  }, [isOpen]);

  // Focus first focusable in drawer when opened; ESC to close
  useEffect(() => {
    if (!isOpen) return;
    const el = drawerRef.current;
    if (!el) return;
    const focusable = el.querySelectorAll<HTMLElement>(FOCUSABLE);
    const first = focusable[0];
    const menuButton = menuButtonRef.current;
    const frame = first ? requestAnimationFrame(() => first.focus()) : null;
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      menuButton?.focus({ preventScroll: true });
    };
  }, [isOpen]);

  // ESC to close
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    if (isOpen) {
      window.addEventListener('keydown', onKeyDown);
      return () => window.removeEventListener('keydown', onKeyDown);
    }
  }, [isOpen]);

  // Focus trap: keep Tab/Shift+Tab inside drawer
  const onDrawerKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== 'Tab' || !drawerRef.current) return;
    const focusable = Array.from(drawerRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (node) => node.tabIndex !== -1 && !(node as HTMLButtonElement).disabled
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey) {
      if (document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }, []);

  const renderNavItem = (item: AppNavigationItem) => {
    const Icon = item.icon;
    const active = isActive(item.href);
    const [itemPath, query] = item.href.split('?');
    const feature = premiumFeatureForLocation(itemPath, new URLSearchParams(query).get('screen'));
    const locked = feature && !planLoading && !planError && !canAccess(feature);

    return (
      <button
        key={item.name}
        type="button"
        onClick={() => handleNavClick(item.href)}
        aria-current={active ? 'page' : undefined}
        className={`flex items-center gap-3 px-3 py-2 rounded-xl transition-[background-color,color,box-shadow] duration-150 ease-out group w-full text-left min-h-[44px] min-w-[44px] no-tap-highlight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${active
          ? 'bg-[var(--sidebar-item-active-bg)] text-foreground shadow-[inset_0_0_0_1px_var(--sidebar-item-active-border)]'
          : 'text-foreground hover:bg-muted active:bg-muted/80 hover:text-foreground'
          }`}
      >
        <Icon
          className={`w-5 h-5 flex-shrink-0 ${active ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground'}`}
        />
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm">{item.name}{locked && <span className="ml-2 text-xs text-muted-foreground">Premium</span>}</div>

        </div>
      </button>
    );
  };

  return (
    <>
      <div className="sticky top-0 z-40 flex shrink-0 items-center gap-1 border-b border-border/70 bg-card/95 px-2 py-1 backdrop-blur lg:hidden" style={{ paddingTop: 'max(0.25rem, env(safe-area-inset-top))' }}>
        <img src="/writeofflogo.png" alt="WriteOff" className="mx-1 h-6 w-6 shrink-0 rounded-md" />
        <nav aria-label="Main sections" className="flex min-w-0 flex-1 items-center justify-evenly gap-0.5">
          {PRIMARY_NAVIGATION.slice(0, 3).map(item => {
            const active = primaryNavigationActive(item.href, pathname, searchParams.get('screen'));
            return <button key={item.href} type="button" onClick={() => handleNavClick(item.href)} aria-current={active ? 'page' : undefined} className={`min-h-11 rounded-lg px-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${active ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}>{item.name}</button>;
          })}
        </nav>
        <button ref={menuButtonRef} type="button" onClick={() => setIsOpen(true)} aria-label="More navigation" aria-expanded={isOpen} aria-controls="mobile-navigation-drawer" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><Menu className="h-5 w-5" /></button>
      </div>

      {isOpen && (
        <div className="lg:hidden fixed inset-0 z-[100] bg-black/50 backdrop-blur-sm" onClick={() => setIsOpen(false)}>
          <div
            ref={drawerRef}
            id="mobile-navigation-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Navigation menu"
            className="w-80 max-w-[85vw] h-full bg-card shadow-xl overflow-y-auto animate-in slide-in-from-left duration-200"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={onDrawerKeyDown}
          >
            {/* Logo/Brand */}
            <div className="p-4 border-b border-border flex items-center justify-between">
              <div className="flex items-center gap-2">
                <img src="/writeofflogo.png" alt="WriteOff" className="w-7 h-7 rounded-lg" />
                <div>
                  <h1 className="text-base font-bold text-foreground">WriteOff</h1>
                  <p className="text-xs text-muted-foreground">Effortless Tax</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg hover:bg-muted transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                aria-label="Close navigation menu"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Navigation Items */}
            <nav className="flex-1 p-2 space-y-1" aria-label="Mobile navigation">
              {/* Main Items */}
              {mainItems.map((item) => renderNavItem(item))}

              <div className="mt-2 border-t border-border/60 pt-2">
                <p className="px-3 py-1 text-xs font-medium text-muted-foreground">Your records</p>
                {RECORD_NAVIGATION.map(item => renderNavItem(item))}
              </div>

              {/* Additional tax tools */}
              <div className="pt-2 mt-2 border-t border-border/40">
                <button
                  type="button"
                  onClick={() => setAdvancedOpen(!advancedOpen)}
                  className="flex items-center justify-between w-full px-3 py-2 rounded-xl text-sm text-muted-foreground hover:bg-muted active:bg-muted/80 transition-colors duration-150 min-h-[44px] no-tap-highlight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  aria-expanded={advancedOpen}
                >
                  <span className="font-medium text-xs uppercase tracking-wider">Tax tools</span>
                  {advancedOpen ? (
                    <ChevronUp className="w-5 h-5 shrink-0" />
                  ) : (
                    <ChevronDown className="w-5 h-5 shrink-0" />
                  )}
                </button>
                {advancedOpen && <div className="pl-2 space-y-1 pt-1">
                  {advancedItems.map(item => renderNavItem(item))}
                </div>}
              </div>

              {/* Bottom Items */}
              <div className="pt-2 mt-2 border-t border-border/40">
                {bottomItems.map((item) => renderNavItem(item))}
              </div>
            </nav>

            {/* User Info and Sign Out */}
            <div className="border-t border-border p-3">
              {/* User Info */}
              <div className="flex items-center gap-2 mb-3">
                <div className="w-7 h-7 bg-muted rounded-full flex items-center justify-center">
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

              {/* Sign Out Button */}
              <LogoutButton
                className="w-full border border-destructive/20 text-destructive bg-card hover:bg-destructive/10 hover:text-destructive font-semibold py-2 rounded-lg transition-all duration-200 flex items-center justify-center gap-2"
                icon={true}
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
};
