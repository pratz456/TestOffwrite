"use client";

import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/firebase/auth-context';
import { makeAuthenticatedRequest } from '@/lib/firebase/api-client';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { X, Calendar, Sparkles, AlertTriangle } from 'lucide-react';
import { useRouter } from 'next/navigation';

interface HistoricalAccessStatus {
  hasAccess: boolean;
  isTrial: boolean;
  isPaid: boolean;
  trialStart?: Date;
  trialEnd?: Date;
  subscriptionEnd?: Date;
  daysRemaining?: number;
}

export function HistoricalAccessNotification() {
  const { user } = useAuth();
  const router = useRouter();
  const [dismissed, setDismissed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [accessStatus, setAccessStatus] = useState<HistoricalAccessStatus | null>(null);

  useEffect(() => {
    if (!user?.id || dismissed) return;

    const fetchAccessStatus = async () => {
      try {
        const response = await makeAuthenticatedRequest('/api/subscriptions/check-access');
        if (response.ok) {
          const data = await response.json();
          setAccessStatus(data.data);
        }
      } catch (error) {
        console.error('Error fetching access status:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchAccessStatus();
  }, [user?.id, dismissed]);

  if (loading || !accessStatus || dismissed) {
    return null;
  }

  // Don't show notification if user has active subscription (trial or paid)
  // Only show notifications for users without access or with expired trials
  if (accessStatus.hasAccess) {
    return null;
  }

  // Show notification if trial expired and user hasn't paid
  if (!accessStatus.hasAccess && accessStatus.subscriptionStatus === 'expired' && accessStatus.trialEnd && new Date(accessStatus.trialEnd) < new Date()) {
    return (
      <Alert className="mb-4 border-muted-foreground/50 bg-muted/50">
        <AlertTriangle className="h-4 w-4 text-muted-foreground" />
        <AlertTitle className="text-foreground">
          Free Trial Ended
        </AlertTitle>
        <AlertDescription className="text-foreground">
          <div className="flex items-center justify-between">
            <span>
              Your free trial has ended. You're now seeing 3 months of transaction history.
              Upgrade to restore 1-year access.
            </span>
            <div className="flex items-center gap-2 ml-4">
              <Button
                variant="outline"
                size="sm"
                onClick={() => router.push('/protected/subscriptions')}
              >
                Upgrade Now
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setDismissed(true)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </AlertDescription>
      </Alert>
    );
  }

  return null;
}

