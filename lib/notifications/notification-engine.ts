import { adminDb } from '@/lib/firebase/admin';
import { getUserTaxRateDisplay } from '@/lib/tax-rules/federal-brackets';
import { runUserProfileBatch, type BatchOptions, type BatchResult, type PageableQuery } from './user-profile-batch';

/** Memory guard for the 30-day deductible sum; far above any realistic month of confirmed expenses. */
const CELEBRATION_SCAN_LIMIT = 2000;

export interface Notification {
  id: string;
  userId: string;
  type: 'tax_deadline' | 'unreviewed_transactions' | 'mileage_reminder' | 'celebration' | 'insight' | 'system';
  title: string;
  message: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  data?: any;
  scheduledFor?: Date;
  sentAt?: Date;
  readAt?: Date;
  actionUrl?: string;
  actionText?: string;
}

export interface NotificationPreferences {
  userId: string;
  email: boolean;
  push: boolean;
  sms: boolean;
  inApp: boolean;
  frequency: 'immediate' | 'daily' | 'weekly';
  types: {
    tax_deadline: boolean;
    unreviewed_transactions: boolean;
    mileage_reminder: boolean;
    celebration: boolean;
    insight: boolean;
    system: boolean;
  };
}

export class NotificationEngine {
  private get db() { return adminDb; }

  /**
   * One collection-group query per user replaces the accounts read plus one query per account.
   * Rows are matched by the canonical `userId` owner field written on every server-created transaction.
   */
  private userTransactions(userId: string): FirebaseFirestore.Query {
    return this.db.collectionGroup('transactions').where('userId', '==', userId);
  }

  private profiles(): PageableQuery {
    return this.db.collection('user_profiles') as unknown as PageableQuery;
  }

  /**
   * Send a notification to a user
   */
  async sendNotification(notification: Omit<Notification, 'id'>): Promise<{ success: boolean; error?: string }> {
    try {
      const notificationId = `notification_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      const fullNotification: Notification = {
        ...notification,
        id: notificationId,
        sentAt: new Date()
      };

      // Store notification in database
      await adminDb.collection('notifications').doc(notificationId).set(fullNotification);

      // Get user preferences
      const preferences = await this.getNotificationPreferences(notification.userId);
      
      if (!preferences) {
        console.warn('⚠️ [Notifications] No preferences found for user:', notification.userId);
        return { success: true }; // Still store the notification
      }

      // Send via enabled channels
      const promises: Promise<any>[] = [];

      if (preferences.inApp && preferences.types[notification.type]) {
        // In-app notification is already stored above
        console.log('✅ [Notifications] In-app notification stored');
      }

      if (preferences.push && preferences.types[notification.type]) {
        promises.push(this.sendPushNotification(fullNotification));
      }

      if (preferences.email && preferences.types[notification.type]) {
        promises.push(this.sendEmailNotification(fullNotification));
      }

      if (preferences.sms && preferences.types[notification.type]) {
        promises.push(this.sendSMSNotification(fullNotification));
      }

      // Wait for all delivery methods
      await Promise.allSettled(promises);

      console.log('✅ [Notifications] Notification sent successfully:', notificationId);
      return { success: true };
    } catch (error) {
      console.error('❌ [Notifications] Error sending notification:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Schedule a notification for later delivery
   */
  async scheduleNotification(notification: Omit<Notification, 'id'>, scheduledFor: Date): Promise<{ success: boolean; error?: string }> {
    try {
      const notificationId = `notification_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      const scheduledNotification: Notification = {
        ...notification,
        id: notificationId,
        scheduledFor
      };

      await adminDb.collection('scheduled_notifications').doc(notificationId).set(scheduledNotification);
      
      console.log('✅ [Notifications] Notification scheduled:', notificationId, 'for', scheduledFor);
      return { success: true };
    } catch (error) {
      console.error('❌ [Notifications] Error scheduling notification:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Get user's notification preferences
   */
  async getNotificationPreferences(userId: string): Promise<NotificationPreferences | null> {
    try {
      const docRef = adminDb.collection('notification_preferences').doc(userId);
      const doc = await docRef.get();
      
      if (doc.exists) {
        return doc.data() as NotificationPreferences;
      }
      
      // Return default preferences if none exist
      return {
        userId,
        email: true,
        push: true,
        sms: false,
        inApp: true,
        frequency: 'immediate',
        types: {
          tax_deadline: true,
          unreviewed_transactions: true,
          mileage_reminder: true,
          celebration: true,
          insight: true,
          system: true
        }
      };
    } catch (error) {
      console.error('❌ [Notifications] Error getting preferences:', error);
      return null;
    }
  }

  /**
   * Update user's notification preferences
   */
  async updateNotificationPreferences(userId: string, preferences: Partial<NotificationPreferences>): Promise<{ success: boolean; error?: string }> {
    try {
      await adminDb.collection('notification_preferences').doc(userId).set({
        userId,
        ...preferences
      }, { merge: true });
      
      console.log('✅ [Notifications] Preferences updated for user:', userId);
      return { success: true };
    } catch (error) {
      console.error('❌ [Notifications] Error updating preferences:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Get user's notifications
   */
  async getUserNotifications(userId: string, limitCount: number = 50): Promise<Notification[]> {
    try {
      const snapshot = await this.db.collection('notifications')
        .where('userId', '==', userId)
        .orderBy('sentAt', 'desc')
        .limit(limitCount)
        .get();

      return snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          ...data,
          sentAt: data.sentAt?.toDate(),
          scheduledFor: data.scheduledFor?.toDate(),
          readAt: data.readAt?.toDate()
        } as Notification;
      });
    } catch (error) {
      console.error('❌ [Notifications] Error getting user notifications:', error);
      return [];
    }
  }

  /**
   * Mark notification as read
   */
  async markAsRead(notificationId: string, userId: string): Promise<{ success: boolean; error?: string }> {
    try {
      await adminDb.collection('notifications').doc(notificationId).update({
        readAt: new Date()
      });
      
      console.log('✅ [Notifications] Notification marked as read:', notificationId);
      return { success: true };
    } catch (error) {
      console.error('❌ [Notifications] Error marking as read:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Generate tax deadline notifications.
   * Pages `user_profiles` (business_income > 0) 200 at a time and stops at the time budget; the
   * returned cursor lets the next run continue instead of restarting from the first profile.
   */
  async generateTaxDeadlineNotifications(options: BatchOptions = {}): Promise<BatchResult | null> {
    try {
      const now = new Date();
      const currentQuarter = Math.floor((now.getMonth() + 3) / 3);
      const nextDeadline = this.getNextTaxDeadline(currentQuarter);
      
      if (!nextDeadline) return null;

      const daysUntilDeadline = Math.ceil((nextDeadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      
      // Only send notifications for upcoming deadlines (within 30 days)
      if (daysUntilDeadline > 30) return null;

      // Range filter => the page order must start with that field (single-field index).
      const base = this.db.collection('user_profiles').where('business_income', '>', 0) as unknown as PageableQuery;
      return await runUserProfileBatch(base, 'business_income', async userDoc => {
        const userData = userDoc.data();
        const userId = userDoc.id;

        // Calculate estimated tax amount
        const estimatedTax = this.calculateEstimatedTax(userData);
        if (estimatedTax === null) return;
        
        let title: string;
        let message: string;
        let priority: 'low' | 'medium' | 'high' | 'urgent';

        if (daysUntilDeadline <= 3) {
          title = '🚨 Tax Deadline Approaching!';
          message = `Your Q${currentQuarter} estimated tax payment of $${estimatedTax.toFixed(0)} is due in ${daysUntilDeadline} days.`;
          priority = 'urgent';
        } else if (daysUntilDeadline <= 7) {
          title = '⚠️ Tax Deadline Next Week';
          message = `Your Q${currentQuarter} estimated tax payment of $${estimatedTax.toFixed(0)} is due in ${daysUntilDeadline} days.`;
          priority = 'high';
        } else if (daysUntilDeadline <= 14) {
          title = '📅 Tax Deadline Reminder';
          message = `Your Q${currentQuarter} estimated tax payment of $${estimatedTax.toFixed(0)} is due in ${daysUntilDeadline} days.`;
          priority = 'medium';
        } else {
          title = '📊 Upcoming Tax Deadline';
          message = `Your Q${currentQuarter} estimated tax payment of $${estimatedTax.toFixed(0)} is due in ${daysUntilDeadline} days.`;
          priority = 'low';
        }

        await this.sendNotification({
          userId,
          type: 'tax_deadline',
          title,
          message,
          priority,
          actionUrl: '/protected?screen=quarterly-taxes',
          actionText: 'View Tax Calculator',
          data: {
            deadline: nextDeadline,
            estimatedAmount: estimatedTax,
            quarter: currentQuarter
          }
        });
      }, options);
    } catch (error) {
      console.error('❌ [Notifications] Error generating tax deadline notifications:', error);
      return null;
    }
  }

  /**
   * Generate unreviewed transactions notifications.
   * Per user: one `count()` aggregation (billed per 1,000 index entries, no document transfer)
   * instead of reading every pending row of every account.
   */
  async generateUnreviewedTransactionsNotifications(options: BatchOptions = {}): Promise<BatchResult | null> {
    try {
      return await runUserProfileBatch(this.profiles(), null, async userDoc => {
        const userId = userDoc.id;
        
        const aggregate = await this.userTransactions(userId).where('analysis_status', '==', 'pending').count().get();
        const unreviewedCount = aggregate.data().count;

        if (unreviewedCount >= 5) {
          await this.sendNotification({
            userId,
            type: 'unreviewed_transactions',
            title: '📋 Transactions Need Review',
            message: `You have ${unreviewedCount} transactions waiting for review. Confirmed records are what count toward your Schedule C totals.`,
            priority: unreviewedCount >= 20 ? 'high' : 'medium',
            actionUrl: '/protected?screen=review-transactions',
            actionText: 'Review Transactions',
            data: { count: unreviewedCount }
          });
        }
      }, options);
    } catch (error) {
      console.error('❌ [Notifications] Error generating unreviewed transactions notifications:', error);
      return null;
    }
  }

  /**
   * Generate mileage reminder notifications.
   * Per user: an existence check (`limit(1)`) on vehicle expenses in the last 7 days.
   */
  async generateMileageReminders(options: BatchOptions = {}): Promise<BatchResult | null> {
    try {
      const base = this.db.collection('user_profiles').where('vehicle_business_use_percentage', '>', 0) as unknown as PageableQuery;
      return await runUserProfileBatch(base, 'vehicle_business_use_percentage', async userDoc => {
        const userId = userDoc.id;
        
        // Check if user has logged mileage recently
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        
        const recentVehicle = await this.userTransactions(userId)
          .where('category', '==', 'vehicle_expense')
          .where('date', '>=', sevenDaysAgo.toISOString().split('T')[0])
          .orderBy('date', 'desc')
          .limit(1)
          .get();

        if (recentVehicle.empty) {
          await this.sendNotification({
            userId,
            type: 'mileage_reminder',
            title: '🚗 Log Your Mileage',
            message: 'You haven\'t logged any business mileage this week. A dated log is required to support a vehicle deduction.',
            priority: 'low',
            actionUrl: '/protected?screen=mileage-tracker',
            actionText: 'Log Mileage'
          });
        }
      }, options);
    } catch (error) {
      console.error('❌ [Notifications] Error generating mileage reminders:', error);
      return null;
    }
  }

  /**
   * Generate celebration notifications.
   * Per user: one bounded query over the last 30 days of deductible rows.
   */
  async generateCelebrationNotifications(options: BatchOptions = {}): Promise<BatchResult | null> {
    try {
      return await runUserProfileBatch(this.profiles(), null, async userDoc => {
        const userId = userDoc.id;
        const userData = userDoc.data();
        
        // Calculate recent deductions (last 30 days)
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        
        const confirmedDeductions = await this.userTransactions(userId)
          .where('is_deductible', '==', true)
          .where('date', '>=', thirtyDaysAgo.toISOString().split('T')[0])
          .orderBy('date', 'desc')
          .limit(CELEBRATION_SCAN_LIMIT)
          .get();
        let totalDeductions = 0;

        for (const doc of confirmedDeductions.docs) {
          const data = doc.data();
          // Unresolved tax facts do not count toward confirmed totals.
          if (data.tax_review_required === true || data.pending === true) continue;
          totalDeductions += Math.abs(data.amount || 0);
        }

        // Acknowledge confirmed review work; the rate is only a planning indicator.
        if (totalDeductions >= 1000) {
          const { rate } = getUserTaxRateDisplay(userData);
          if (rate === null) return;
          await this.sendNotification({
            userId,
            type: 'celebration',
            title: '🎉 Great Job!',
            message: `You've confirmed $${totalDeductions.toFixed(0)} in business expenses this month. At your planning rate of ${Math.round(rate * 100)}%, that is roughly $${(totalDeductions * rate).toFixed(0)} in potential federal tax impact, subject to your full-year review.`,
            priority: 'low',
            actionUrl: '/protected?screen=ai-insights',
            actionText: 'View Insights',
            data: { totalDeductions }
          });
        }
      }, options);
    } catch (error) {
      console.error('❌ [Notifications] Error generating celebration notifications:', error);
      return null;
    }
  }

  private getNextTaxDeadline(currentQuarter: number): Date | null {
    const year = new Date().getFullYear();
    const deadlines = [
      new Date(year, 3, 15), // Q1: April 15
      new Date(year, 5, 15), // Q2: June 15
      new Date(year, 8, 15), // Q3: September 15
      new Date(year, 0, 15)  // Q4: January 15 (next year)
    ];

    // If we're past Q4 deadline, use next year's Q1
    if (currentQuarter === 4 && new Date() > deadlines[3]) {
      return new Date(year + 1, 3, 15);
    }

    return deadlines[currentQuarter - 1] || null;
  }

  private calculateEstimatedTax(userData: any): number | null {
    const businessIncome = userData.business_income || 0;
    const w2Income = userData.w2_income || 0;
    const totalIncome = businessIncome + w2Income;
    
    // Use effective tax rate from profile for estimation
    const profileForRate = { income: totalIncome, filing_status: userData.filing_status };
    const { rate } = getUserTaxRateDisplay(profileForRate);
    return rate === null ? null : businessIncome * rate;
  }

  private async sendPushNotification(notification: Notification): Promise<void> {
    // Implementation would use Firebase Cloud Messaging
    console.log('📱 [Notifications] Push notification would be sent:', notification.title);
  }

  private async sendEmailNotification(notification: Notification): Promise<void> {
    // Implementation would use email service (SendGrid, etc.)
    console.log('📧 [Notifications] Email notification would be sent:', notification.title);
  }

  private async sendSMSNotification(notification: Notification): Promise<void> {
    // Implementation would use SMS service (Twilio, etc.)
    console.log('📱 [Notifications] SMS notification would be sent:', notification.title);
  }
}

// Export singleton instance
export const notificationEngine = new NotificationEngine();
