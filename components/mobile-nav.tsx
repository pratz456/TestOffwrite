'use client';

import React, { useState, useEffect } from 'react';
import { usePathname, useSearchParams, useRouter } from 'next/navigation';
import { Menu, X, Home, CreditCard, BarChart3, Settings, FolderOpen, HelpCircle, Shield, Info } from 'lucide-react';
import { LogoutButton } from './logout-button';

interface MobileNavProps {
  user: { id: string; email?: string; user_metadata?: { name?: string } };
  userProfile?: { name?: string; email?: string };
}

export const MobileNav: React.FC<MobileNavProps> = ({ user, userProfile }) => {
  const [isOpen, setIsOpen] = useState(false);
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
      return pathname === '/protected' && !searchParams.has('screen');
    }
    if (href === '/protected?screen=categories') {
      return pathname === '/protected' && searchParams.get('screen') === 'categories';
    }
    if (href === '/protected/settings') {
      return pathname === '/protected/settings';
    }
    return pathname.startsWith(href);
  };

  const handleNavClick = (href: string) => {
    setIsOpen(false);
    if (href === '/protected') {
      router.push('/protected');
    } else {
      router.push(href);
    }
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

  return (
    <>
      {/* Mobile Header */}
      <div className="lg:hidden bg-card border-b border-border px-3 py-3 flex items-center justify-between sticky top-0 z-[100] safe-area-inset-top">
        {/* Left: Menu Button */}
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="p-2.5 rounded-lg hover:bg-muted active:bg-muted/80 transition-colors no-tap-highlight min-w-[44px] min-h-[44px] flex items-center justify-center"
          aria-label="Toggle navigation menu"
        >
          {isOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>

        {/* Center: Logo and Title */}
        <div className="flex items-center gap-2">
          <img src="/writeofflogo.png" alt="WriteOff" className="w-6 h-6 rounded" />
          <h1 className="text-lg font-bold text-foreground">WriteOff</h1>
        </div>

        {/* Right: Settings Button */}
        <button
          onClick={() => {
            setIsOpen(false);
            router.push('/protected/settings');
          }}
          className="p-2.5 rounded-lg hover:bg-muted active:bg-muted/80 transition-colors no-tap-highlight min-w-[44px] min-h-[44px] flex items-center justify-center"
          aria-label="Settings"
        >
          <Settings className="w-5 h-5" />
        </button>
      </div>

      {/* Mobile Navigation Overlay - z-[55] so it stays above page content (e.g. Settings header z-50) */}
      {isOpen && (
        <div className="lg:hidden fixed inset-0 z-[55] bg-black/50 backdrop-blur-sm" onClick={() => setIsOpen(false)}>
          <div 
            className="w-80 max-w-[85vw] h-full bg-card shadow-xl overflow-y-auto animate-in slide-in-from-left duration-200"
            onClick={(e) => e.stopPropagation()}
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
                onClick={() => setIsOpen(false)}
                className="p-2 rounded-lg hover:bg-muted transition-colors"
                aria-label="Close navigation menu"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Navigation Items */}
            <nav className="flex-1 p-2 space-y-1">
              {navItems.map((item) => {
                const Icon = item.icon;
                const active = isActive(item.href);

                return (
                  <button
                    key={item.name}
                    onClick={() => handleNavClick(item.href)}
                    className={`flex items-center gap-3 px-3 py-3 rounded-xl transition-colors group w-full text-left min-h-[52px] no-tap-highlight ${active
                      ? 'bg-primary/10 text-primary border border-primary/20'
                      : 'text-foreground hover:bg-muted active:bg-muted/80 hover:text-foreground'
                      }`}
                  >
                    <Icon
                      className={`w-5 h-5 flex-shrink-0 ${active ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground'
                        }`}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm">{item.name}</div>
                      <div className={`text-xs truncate ${active ? 'text-primary/80' : 'text-muted-foreground'
                        }`}>
                        {item.description}
                      </div>
                    </div>
                  </button>
                );
              })}
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
