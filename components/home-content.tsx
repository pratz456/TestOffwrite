import React from 'react';
import { Button } from '../ui/button';
import writeOffLogo from '@/public/writeofflogo.png';
import Image from 'next/image';
import Link from 'next/link';
import { HelpCircle, Shield, Info, MessageCircle } from 'lucide-react';

export function HomeContent() {
  return (
    <div className="min-h-screen bg-background safe-area-inset-top safe-area-inset-bottom">
      {/* Background with subtle gradient */}
      <div className="absolute inset-0 bg-muted/20"></div>
      
      <div className="relative min-h-screen flex flex-col justify-center px-4 py-8 sm:px-6 lg:px-8 overflow-x-hidden">
        <div className="w-full">
          {/* Logo and heading */}
          <div className="text-center space-y-4 mb-8">
            <div className="flex justify-center">
              <Image src={writeOffLogo} alt="WriteOff" className="w-28 sm:w-32 h-auto"/>
            </div>
            
            <div className="space-y-3">
              <h1 className="text-2xl sm:text-3xl md:text-4xl font-medium text-foreground tracking-tight">
                Welcome to WriteOff
              </h1>
              <p className="text-base sm:text-lg text-muted-foreground max-w-sm mx-auto leading-relaxed px-2">
                AI-powered tax optimization for modern professionals
              </p>
            </div>
          </div>

          {/* Main content card */}
          <div className="bg-card/80 backdrop-blur-xl rounded-xl shadow-lg shadow-black/5 dark:shadow-black/25 ring-1 ring-border p-5 sm:p-6 space-y-5 max-w-md mx-auto">
            <div className="text-center space-y-2">
              <h2 className="text-lg sm:text-xl font-medium text-card-foreground">Get started</h2>
              <p className="text-sm text-muted-foreground">
                Create an account or sign in to access your personalized dashboard
              </p>
            </div>

            <div className="flex flex-col gap-3 sm:gap-4">
              <Link href="/auth/sign-up">
                <Button className="w-full h-12 sm:h-11 bg-primary hover:bg-primary-hover text-primary-foreground rounded-lg font-medium text-base sm:text-sm transition-all duration-200 shadow-sm hover:shadow-md no-tap-highlight">
                  Create Account
                </Button>
              </Link>

              <Link href="/auth/login">
                <Button
                  variant="outline"
                  className="w-full h-12 sm:h-11 bg-background hover:bg-muted text-foreground border border-border hover:border-primary/30 rounded-lg font-medium text-base sm:text-sm transition-all duration-200 shadow-sm hover:shadow-md no-tap-highlight"
                >
                  Sign In
                </Button>
              </Link>
            </div>

            {/* Feature highlights */}
            <div className="mt-6 grid grid-cols-3 gap-2 sm:gap-3">
              <div className="text-center space-y-2 p-3 rounded-lg hover:bg-muted/50 transition-colors">
                <div className="w-10 h-10 sm:w-8 sm:h-8 bg-primary/10 rounded-lg flex items-center justify-center mx-auto">
                  <svg className="w-5 h-5 sm:w-4 sm:h-4 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                  </svg>
                </div>
                <p className="text-xs sm:text-xs font-medium text-muted-foreground">AI Analysis</p>
              </div>
              <div className="text-center space-y-2 p-3 rounded-lg hover:bg-muted/50 transition-colors">
                <div className="w-10 h-10 sm:w-8 sm:h-8 bg-accent/10 rounded-lg flex items-center justify-center mx-auto">
                  <svg className="w-5 h-5 sm:w-4 sm:h-4 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                </div>
                <p className="text-xs sm:text-xs font-medium text-muted-foreground">Bank Sync</p>
              </div>
              <div className="text-center space-y-2 p-3 rounded-lg hover:bg-muted/50 transition-colors">
                <div className="w-10 h-10 sm:w-8 sm:h-8 bg-muted rounded-lg flex items-center justify-center mx-auto">
                  <svg className="w-5 h-5 sm:w-4 sm:h-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
                  </svg>
                </div>
                <p className="text-xs sm:text-xs font-medium text-muted-foreground">Auto-Detect</p>
              </div>
            </div>

            {/* Help & Support Section */}
            <div className="mt-8 pt-6 border-t border-border">
              <div className="text-center space-y-4">
                <h3 className="text-lg font-medium text-foreground">Need Help?</h3>
                <p className="text-sm text-muted-foreground">
                  Get support, learn about our platform, or read our policies
                </p>
                
                <div className="grid grid-cols-1 gap-3">
                  <Link href="/help" prefetch={false}>
                    <Button 
                      variant="outline" 
                      className="w-full h-12 sm:h-11 bg-background hover:bg-muted text-foreground border border-border hover:border-primary/30 rounded-lg font-medium text-base sm:text-sm transition-all duration-200 shadow-sm hover:shadow-md no-tap-highlight"
                    >
                      <HelpCircle className="w-5 h-5 sm:w-4 sm:h-4 mr-2" />
                      Help & Support
                    </Button>
                  </Link>
                  
                  <div className="grid grid-cols-2 gap-2 sm:gap-3">
                    <Link href="/privacy" prefetch={false}>
                      <Button 
                        variant="ghost" 
                        size="sm"
                        className="w-full h-11 sm:h-9 text-sm sm:text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 no-tap-highlight"
                      >
                        <Shield className="w-4 h-4 sm:w-3 sm:h-3 mr-1.5 sm:mr-1" />
                        Privacy Policy
                      </Button>
                    </Link>
                    <Link href="/about" prefetch={false}>
                      <Button 
                        variant="ghost" 
                        size="sm"
                        className="w-full h-11 sm:h-9 text-sm sm:text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 no-tap-highlight"
                      >
                        <Info className="w-4 h-4 sm:w-3 sm:h-3 mr-1.5 sm:mr-1" />
                        About Us
                      </Button>
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="mt-10 sm:mt-12 max-w-md mx-auto pb-8">
            <div className="text-center space-y-4">
              <div className="flex flex-wrap justify-center gap-4 sm:gap-6 text-sm sm:text-xs text-muted-foreground">
                <Link href="/help" prefetch={false} className="hover:text-foreground transition-colors py-1 no-tap-highlight">
                  Help
                </Link>
                <Link href="/privacy" prefetch={false} className="hover:text-foreground transition-colors py-1 no-tap-highlight">
                  Privacy
                </Link>
                <Link href="/about" prefetch={false} className="hover:text-foreground transition-colors py-1 no-tap-highlight">
                  About
                </Link>
                <a href="mailto:writeoffapp@gmail.com" className="hover:text-foreground transition-colors py-1 no-tap-highlight">
                  Contact
                </a>
              </div>
              <p className="text-xs text-muted-foreground">
                © {new Date().getFullYear()} WriteOff. All rights reserved.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
} 