import { 
  collection, 
  doc, 
  getDoc, 
  setDoc, 
  getDocs, 
  query, 
  where, 
  orderBy, 
  limit,
  Timestamp 
} from 'firebase/firestore';
import { db } from './client';
import { UserCorrection, LearningPattern } from '@/lib/ai/learning-engine';

export interface CorrectionStats {
  totalCorrections: number;
  accuracyImprovement: number;
  topCorrectionReasons: string[];
  learningProgress: number;
  merchantInsights: any[];
  categoryInsights: any[];
  recommendations: string[];
}

/**
 * Client-side functions for managing user corrections and learning patterns
 */
export class CorrectionsManager {
  /**
   * Record a user correction
   */
  async recordCorrection(
    userId: string,
    transactionId: string,
    transactionData: any,
    originalAnalysis: any,
    userCorrection: { isDeductible: boolean; reasoning?: string }
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const correctionId = `correction_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      const correction: UserCorrection = {
        id: correctionId,
        userId,
        transactionId,
        merchantName: transactionData.merchant_name || transactionData.name || 'Unknown',
        category: transactionData.category || 'Other',
        originalAIAnalysis: {
          isDeductible: originalAnalysis.is_deductible || false,
          confidence: originalAnalysis.confidence || 0,
          reasoning: originalAnalysis.reasoning || originalAnalysis.customized_reason || 'No reasoning provided'
        },
        userCorrection,
        correctionType: this.determineCorrectionType(originalAnalysis, userCorrection),
        timestamp: new Date(),
        context: {
          amount: transactionData.amount || 0,
          date: transactionData.date || '',
          mcc: transactionData.mcc,
          location: transactionData.location
        }
      };

      await setDoc(doc(db, 'user_corrections', correctionId), {
        ...correction,
        timestamp: Timestamp.fromDate(correction.timestamp)
      });

      return { success: true };
    } catch (error) {
      console.error('❌ [Corrections] Error recording correction:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Get user's correction history
   */
  async getCorrectionHistory(userId: string, limitCount: number = 50): Promise<UserCorrection[]> {
    try {
      const q = query(
        collection(db, 'user_corrections'),
        where('userId', '==', userId),
        orderBy('timestamp', 'desc'),
        limit(limitCount)
      );

      const snapshot = await getDocs(q);
      return snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          ...data,
          timestamp: data.timestamp.toDate()
        } as UserCorrection;
      });
    } catch (error) {
      console.error('❌ [Corrections] Error getting correction history:', error);
      return [];
    }
  }

  /**
   * Get learning patterns for user
   */
  async getLearningPatterns(userId: string): Promise<LearningPattern | null> {
    try {
      const patternsRef = doc(db, 'learning_patterns', userId);
      const patternsDoc = await getDoc(patternsRef);
      
      if (!patternsDoc.exists()) {
        return null;
      }

      const data = patternsDoc.data();
      return {
        ...data,
        lastUpdated: data.lastUpdated.toDate()
      } as LearningPattern;
    } catch (error) {
      console.error('❌ [Corrections] Error getting learning patterns:', error);
      return null;
    }
  }

  /**
   * Get correction statistics and insights
   */
  async getCorrectionStats(userId: string): Promise<CorrectionStats> {
    try {
      const corrections = await this.getCorrectionHistory(userId, 100);
      const patterns = await this.getLearningPatterns(userId);

      if (!patterns || corrections.length === 0) {
        return {
          totalCorrections: 0,
          accuracyImprovement: 0,
          topCorrectionReasons: [],
          learningProgress: 0,
          merchantInsights: [],
          categoryInsights: [],
          recommendations: []
        };
      }

      return {
        totalCorrections: corrections.length,
        accuracyImprovement: this.calculateAccuracyImprovement(corrections),
        topCorrectionReasons: this.getTopCorrectionReasons(corrections),
        learningProgress: this.calculateLearningProgress(patterns),
        merchantInsights: this.getMerchantInsights(patterns),
        categoryInsights: this.getCategoryInsights(patterns),
        recommendations: this.generateRecommendations(corrections, patterns)
      };
    } catch (error) {
      console.error('❌ [Corrections] Error getting correction stats:', error);
      return {
        totalCorrections: 0,
        accuracyImprovement: 0,
        topCorrectionReasons: [],
        learningProgress: 0,
        merchantInsights: [],
        categoryInsights: [],
        recommendations: []
      };
    }
  }

  /**
   * Get recent corrections for a specific merchant
   */
  async getMerchantCorrections(userId: string, merchantName: string): Promise<UserCorrection[]> {
    try {
      const q = query(
        collection(db, 'user_corrections'),
        where('userId', '==', userId),
        where('merchantName', '==', merchantName),
        orderBy('timestamp', 'desc'),
        limit(10)
      );

      const snapshot = await getDocs(q);
      return snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          ...data,
          timestamp: data.timestamp.toDate()
        } as UserCorrection;
      });
    } catch (error) {
      console.error('❌ [Corrections] Error getting merchant corrections:', error);
      return [];
    }
  }

  /**
   * Get corrections by category
   */
  async getCategoryCorrections(userId: string, category: string): Promise<UserCorrection[]> {
    try {
      const q = query(
        collection(db, 'user_corrections'),
        where('userId', '==', userId),
        where('category', '==', category),
        orderBy('timestamp', 'desc'),
        limit(10)
      );

      const snapshot = await getDocs(q);
      return snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          ...data,
          timestamp: data.timestamp.toDate()
        } as UserCorrection;
      });
    } catch (error) {
      console.error('❌ [Corrections] Error getting category corrections:', error);
      return [];
    }
  }

  private determineCorrectionType(originalAnalysis: any, userCorrection: any): 'override' | 'refinement' | 'category_change' {
    if (originalAnalysis.is_deductible !== userCorrection.isDeductible) {
      return 'override';
    }
    if (userCorrection.reasoning && userCorrection.reasoning !== originalAnalysis.reasoning) {
      return 'refinement';
    }
    return 'category_change';
  }

  private calculateAccuracyImprovement(corrections: UserCorrection[]): number {
    if (corrections.length < 10) return 0;
    
    const recent = corrections.slice(0, 10);
    const older = corrections.slice(10, 20);
    
    if (older.length === 0) return 0;
    
    const recentAccuracy = recent.filter(c => c.correctionType === 'override').length / recent.length;
    const olderAccuracy = older.filter(c => c.correctionType === 'override').length / older.length;
    
    return Math.max(0, olderAccuracy - recentAccuracy);
  }

  private getTopCorrectionReasons(corrections: UserCorrection[]): string[] {
    const reasons = corrections
      .filter(c => c.userCorrection.reasoning)
      .map(c => c.userCorrection.reasoning!)
      .reduce((acc, reason) => {
        acc[reason] = (acc[reason] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

    return Object.entries(reasons)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 5)
      .map(([reason]) => reason);
  }

  private calculateLearningProgress(patterns: LearningPattern): number {
    const totalPatterns = Object.keys(patterns.merchantPatterns).length + 
                         Object.keys(patterns.categoryPatterns).length + 
                         Object.keys(patterns.mccPatterns).length;
    
    return Math.min(100, (totalPatterns / 50) * 100); // 50 patterns = 100% progress
  }

  private getMerchantInsights(patterns: LearningPattern): any[] {
    return Object.entries(patterns.merchantPatterns)
      .filter(([, pattern]) => pattern.correctionCount >= 2)
      .map(([merchant, pattern]) => ({
        merchant,
        correctionCount: pattern.correctionCount,
        preferredClassification: pattern.preferredClassification,
        confidence: pattern.confidence
      }))
      .sort((a, b) => b.correctionCount - a.correctionCount)
      .slice(0, 5);
  }

  private getCategoryInsights(patterns: LearningPattern): any[] {
    return Object.entries(patterns.categoryPatterns)
      .filter(([, pattern]) => pattern.correctionCount >= 2)
      .map(([category, pattern]) => ({
        category,
        correctionCount: pattern.correctionCount,
        preferredClassification: pattern.preferredClassification,
        confidence: pattern.confidence
      }))
      .sort((a, b) => b.correctionCount - a.correctionCount)
      .slice(0, 5);
  }

  private generateRecommendations(corrections: UserCorrection[], patterns: LearningPattern): string[] {
    const recommendations: string[] = [];
    
    if (corrections.length > 20) {
      recommendations.push("You've made many corrections! The AI is learning your preferences.");
    }
    
    const merchantInsights = this.getMerchantInsights(patterns);
    if (merchantInsights.length > 0) {
      recommendations.push(`Consider setting up rules for ${merchantInsights[0].merchant} to reduce manual corrections.`);
    }
    
    const categoryInsights = this.getCategoryInsights(patterns);
    if (categoryInsights.length > 0) {
      recommendations.push(`Your ${categoryInsights[0].category} expenses often need manual review.`);
    }
    
    return recommendations;
  }
}

// Export singleton instance
export const correctionsManager = new CorrectionsManager();
