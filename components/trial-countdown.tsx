"use client";

import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Calendar, Clock } from 'lucide-react';

interface TrialCountdownProps {
  trialEnd: Date;
  isTrial: boolean;
}

export function TrialCountdown({ trialEnd, isTrial }: TrialCountdownProps) {
  const [timeRemaining, setTimeRemaining] = useState<{
    days: number;
    hours: number;
    minutes: number;
    seconds: number;
  } | null>(null);

  useEffect(() => {
    const updateCountdown = () => {
      const now = new Date();
      const end = new Date(trialEnd);
      const diff = end.getTime() - now.getTime();

      if (diff <= 0) {
        setTimeRemaining({ days: 0, hours: 0, minutes: 0, seconds: 0 });
        return;
      }

      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);

      setTimeRemaining({ days, hours, minutes, seconds });
    };

    // Update immediately
    updateCountdown();

    // Update every second
    const interval = setInterval(updateCountdown, 1000);

    return () => clearInterval(interval);
  }, [trialEnd]);

  if (!timeRemaining) {
    return null;
  }

  const { days, hours, minutes, seconds } = timeRemaining;
  const isExpiringSoon = days <= 7 && days > 0;
  const isExpired = days === 0 && hours === 0 && minutes === 0 && seconds === 0;

  if (isExpired) {
    return (
      <Card className="border-red-500/50 bg-red-500/10">
        <CardContent className="p-4">
          <div className="flex items-center gap-2">
            <Calendar className="w-5 h-5 text-red-600" />
            <div>
              <p className="font-semibold text-red-600">Free Trial Expired</p>
              <p className="text-sm text-muted-foreground">Upgrade to continue 1-year access, or use free tier with 3 months</p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={`${isExpiringSoon ? 'border-yellow-500/50 dark:border-yellow-500/50 bg-yellow-500/15 dark:bg-yellow-500/10' : 'border-primary/40 dark:border-primary/20 bg-primary/20 dark:bg-primary/5 shadow-md'}`}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Clock className={`w-5 h-5 ${isExpiringSoon ? 'text-yellow-600' : 'text-primary'}`} />
            <div>
              <p className="font-semibold text-foreground">
                {isTrial ? 'Free Trial' : 'Subscription'} {isExpiringSoon ? 'Expiring Soon' : 'Active'}
              </p>
              <p className="text-xs text-muted-foreground">
                {isTrial ? 'Trial ends' : 'Renews'} on {trialEnd.toLocaleDateString()}
              </p>
            </div>
          </div>
          <div className="text-right">
            <div className="flex items-baseline gap-1">
              <span className="text-2xl font-bold text-foreground">{days}</span>
              <span className="text-sm text-muted-foreground">d</span>
            </div>
            {/* Only show hours/minutes/seconds for paid subscriptions, not for free trials */}
            {!isTrial && (
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <span>{String(hours).padStart(2, '0')}h</span>
                <span>{String(minutes).padStart(2, '0')}m</span>
                <span>{String(seconds).padStart(2, '0')}s</span>
              </div>
            )}
          </div>
        </div>
        {isExpiringSoon && (
          <div className="mt-3 pt-3 border-t border-yellow-500/20">
            <p className="text-xs text-yellow-700 dark:text-yellow-300">
              ⚠️ Your free trial will end in {days} day{days !== 1 ? 's' : ''}. Upgrade to keep 1-year access, or continue with 3 months on the free tier.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

