"use client";

import React from 'react';
import { LogoutButton } from './logout-button';
import Link from 'next/link';
import { usePathname, useSearchParams, useRouter } from 'next/navigation';
import { Home, CreditCard, BarChart3, Settings, FolderOpen, HelpCircle, Shield, Info } from 'lucide-react';
interface SidebarNavProps {
  user: { id: string; email?: string; user_metadata?: { name?: string } };
  userProfile?: { name?: string; email?: string };
}

export const SidebarNav: React.FC<SidebarNavProps> = ({ user, userProfile }) => {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();



  const navItems = [
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
      name: 'Categories',
      href: '/protected?screen=categories',
      icon: FolderOpen,
      description: 'Manage expense categories'
    },
    {
      name: 'Reports',
      href: '/protected/reports',
      icon: BarChart3,
      description: 'Tax reports and analytics'
    },
    {
      name: 'Settings',
      href: '/protected/settings',
      icon: Settings,
      description: 'Account and preferences'
    },
    {
      name: 'Help',
      href: '/protected/help',
      icon: HelpCircle,
      description: 'Help and support'
    },
    {
      name: 'Privacy',
      href: '/protected/privacy',
      icon: Shield,
      description: 'Privacy policy'
    },
    {
      name: 'About',
      href: '/protected/about',
      icon: Info,
      description: 'About WriteOff'
    }
  ];

  const isActive = (href: string) => {
    if (href === '/protected') {
      // Home should only be active when exactly on /protected with no query params
      return pathname === '/protected' && !searchParams.has('screen');
    }

    // For Categories, check if we're on the categories screen
    if (href === '/protected?screen=categories') {
      return pathname === '/protected' && searchParams.get('screen') === 'categories';
    }

    // For Settings, check if we're on the settings page
    if (href === '/protected/settings') {
      return pathname === '/protected/settings';
    }

    // For other pages, check if the pathname starts with the href
    return pathname.startsWith(href);
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
      <nav className="flex-1 px-2 py-2 space-y-0.5">
        {navItems.map((item) => {
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
            >
              <Icon className={`w-4 h-4 shrink-0 ${iconClasses}`} />
              <span className="font-medium truncate">{item.name}</span>
            </Link>
          );
        })}
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
