import { adminDb } from '@/lib/firebase/admin';
import { getFirestore, collection, doc, getDocs, query, where, orderBy, limit } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';

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
  private db = getFirestore();

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
      const q = query(
        collection(this.db, 'notifications'),
        where('userId', '==', userId),
        orderBy('sentAt', 'desc'),
        limit(limitCount)
      );

      const snapshot = await getDocs(q);
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
   * Generate tax deadline notifications
   */
  async generateTaxDeadlineNotifications(): Promise<void> {
    try {
      const now = new Date();
      const currentQuarter = Math.floor((now.getMonth() + 3) / 3);
      const nextDeadline = this.getNextTaxDeadline(currentQuarter);
      
      if (!nextDeadline) return;

      const daysUntilDeadline = Math.ceil((nextDeadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      
      // Only send notifications for upcoming deadlines (within 30 days)
      if (daysUntilDeadline > 30) return;

      // Get all users with business income
      const usersSnapshot = await adminDb.collection('user_profiles')
        .where('business_income', '>', 0)
        .get();

      for (const userDoc of usersSnapshot.docs) {
        const userData = userDoc.data();
        const userId = userDoc.id;

        // Calculate estimated tax amount
        const estimatedTax = this.calculateEstimatedTax(userData);
        
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
      }
    } catch (error) {
      console.error('❌ [Notifications] Error generating tax deadline notifications:', error);
    }
  }

  /**
   * Generate unreviewed transactions notifications
   */
  async generateUnreviewedTransactionsNotifications(): Promise<void> {
    try {
      // Get all users
      const usersSnapshot = await adminDb.collection('user_profiles').get();

      for (const userDoc of usersSnapshot.docs) {
        const userId = userDoc.id;
        
        // Count unreviewed transactions
        const unreviewedQuery = query(
          collection(this.db, 'user_profiles', userId, 'accounts', 'default', 'transactions'),
          where('analysis_status', '==', 'pending')
        );
        
        const unreviewedSnapshot = await getDocs(unreviewedQuery);
        const unreviewedCount = unreviewedSnapshot.size;

        if (unreviewedCount >= 5) {
          await this.sendNotification({
            userId,
            type: 'unreviewed_transactions',
            title: '📋 Transactions Need Review',
            message: `You have ${unreviewedCount} transactions waiting for review. Review them to maximize your deductions.`,
            priority: unreviewedCount >= 20 ? 'high' : 'medium',
            actionUrl: '/protected/transactions?filter=unreviewed',
            actionText: 'Review Transactions',
            data: { count: unreviewedCount }
          });
        }
      }
    } catch (error) {
      console.error('❌ [Notifications] Error generating unreviewed transactions notifications:', error);
    }
  }

  /**
   * Generate mileage reminder notifications
   */
  async generateMileageReminders(): Promise<void> {
    try {
      // Get users who haven't logged mileage in the last 7 days
      const usersSnapshot = await adminDb.collection('user_profiles')
        .where('vehicle_business_use_percentage', '>', 0)
        .get();

      for (const userDoc of usersSnapshot.docs) {
        const userId = userDoc.id;
        
        // Check if user has logged mileage recently
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        
        const mileageQuery = query(
          collection(this.db, 'user_profiles', userId, 'accounts', 'default', 'transactions'),
          where('category', '==', 'vehicle_expense'),
          where('date', '>=', sevenDaysAgo.toISOString().split('T')[0])
        );
        
        const mileageSnapshot = await getDocs(mileageQuery);
        
        if (mileageSnapshot.size === 0) {
          await this.sendNotification({
            userId,
            type: 'mileage_reminder',
            title: '🚗 Log Your Mileage',
            message: 'You haven\'t logged any business mileage this week. Don\'t miss out on valuable deductions!',
            priority: 'low',
            actionUrl: '/protected?screen=mileage-tracker',
            actionText: 'Log Mileage'
          });
        }
      }
    } catch (error) {
      console.error('❌ [Notifications] Error generating mileage reminders:', error);
    }
  }

  /**
   * Generate celebration notifications
   */
  async generateCelebrationNotifications(): Promise<void> {
    try {
      // Get users with recent high-value deductions
      const usersSnapshot = await adminDb.collection('user_profiles').get();

      for (const userDoc of usersSnapshot.docs) {
        const userId = userDoc.id;
        
        // Calculate recent deductions (last 30 days)
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        
        const deductionsQuery = query(
          collection(this.db, 'user_profiles', userId, 'accounts', 'default', 'transactions'),
          where('is_deductible', '==', true),
          where('date', '>=', thirtyDaysAgo.toISOString().split('T')[0])
        );
        
        const deductionsSnapshot = await getDocs(deductionsQuery);
        let totalDeductions = 0;
        
        deductionsSnapshot.forEach(doc => {
          const data = doc.data();
          totalDeductions += Math.abs(data.amount || 0);
        });

        // Send celebration for significant savings
        if (totalDeductions >= 1000) {
          await this.sendNotification({
            userId,
            type: 'celebration',
            title: '🎉 Great Job!',
            message: `You've identified $${totalDeductions.toFixed(0)} in deductions this month. That's potential tax savings of $${(totalDeductions * 0.25).toFixed(0)}!`,
            priority: 'low',
            actionUrl: '/protected?screen=ai-insights',
            actionText: 'View Insights',
            data: { totalDeductions }
          });
        }
      }
    } catch (error) {
      console.error('❌ [Notifications] Error generating celebration notifications:', error);
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

  private calculateEstimatedTax(userData: any): number {
    const businessIncome = userData.business_income || 0;
    const w2Income = userData.w2_income || 0;
    const totalIncome = businessIncome + w2Income;
    
    // Simple estimation: 25% of business income for self-employment tax + income tax
    return businessIncome * 0.25;
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
