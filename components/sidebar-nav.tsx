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
    <div className="hidden lg:flex w-64 bg-card border-r border-border h-screen flex-col">
      {/* Logo/Brand */}
      <div className="p-4 border-b border-border">
        <div className="flex items-center gap-2">
          <img src="/writeofflogo.png" alt="WriteOff" className="w-7 h-7 rounded-lg" />
          <div>
            <h1 className="text-base font-bold text-foreground">WriteOff</h1>
            <p className="text-xs text-muted-foreground">Effortless Tax</p>
          </div>
        </div>
      </div>

      {/* Navigation Items */}
      <nav className="flex-1 p-2 space-y-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.href);

          // Special handling for Home button to ensure proper navigation
          if (item.isHome) {
            return (
              <button
                key={item.name}
                onClick={() => {
                  router.push('/protected');
                }}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-colors group w-full text-left ${active
                  ? 'bg-primary/10 text-primary border border-primary/20'
                  : 'text-foreground hover:bg-muted hover:text-foreground'
                  }`}
              >
                <Icon
                  className={`w-5 h-5 ${active ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground'
                    }`}
                />
                <div className="flex-1">
                  <div className="font-medium">{item.name}</div>
                  <div className={`text-xs ${active ? 'text-primary' : 'text-muted-foreground'
                    }`}>
                    {item.description}
                  </div>
                </div>
              </button>
            );
          }

          return (
            <Link
              key={item.name}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-colors group ${active
                ? 'bg-primary/10 text-primary border border-primary/20'
                : 'text-foreground hover:bg-muted hover:text-foreground'
                }`}
            >
              <Icon
                className={`w-5 h-5 ${active ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground'
                  }`}
              />
              <div className="flex-1">
                <div className="font-medium">{item.name}</div>
                <div className={`text-xs ${active ? 'text-primary' : 'text-muted-foreground'
                  }`}>
                  {item.description}
                </div>
              </div>
            </Link>
          );
        })}

      </nav>

      {/* User Info and Sign Out */}
      <div className="border-t border-border">
        {/* User Info */}
        <div className="p-3 flex flex-col items-center">
          <div className="flex items-center gap-2 w-full mb-3">
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
        </div>
        
        {/* Sign Out Button */}
        <div className="p-3 border-t border-border">
          <LogoutButton 
            className="w-full border border-destructive/20 text-destructive bg-card hover:bg-destructive/10 hover:text-destructive font-semibold py-2 rounded-lg transition-all duration-200 flex items-center justify-center gap-2" 
            icon={true}
          />
        </div>
      </div>
    </div>
  );
};
