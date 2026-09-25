import { adminDb } from '@/lib/firebase/admin';
import { learningMerchantKey } from './merchant-key';
export interface UserCorrection {
  id: string;
  userId: string;
  transactionId: string;
  merchantName: string;
  category: string;
  originalAIAnalysis: {
    isDeductible: boolean;
    confidence: number;
    reasoning: string;
  };
  userCorrection: {
    isDeductible: boolean;
    reasoning?: string;
  };
  correctionType: 'override' | 'refinement' | 'category_change';
  timestamp: Date;
  context: {
    amount: number;
    date: string;
    mcc?: string;
    location?: string;
  };
}

export interface LearningPattern {
  userId: string;
  merchantPatterns: {
    [merchantName: string]: {
      correctionCount: number;
      lastCorrection: Date;
      preferredClassification: boolean;
      confidence: number;
    };
  };
  categoryPatterns: {
    [category: string]: {
      correctionCount: number;
      lastCorrection: Date;
      preferredClassification: boolean;
      confidence: number;
    };
  };
  mccPatterns: {
    [mcc: string]: {
      correctionCount: number;
      lastCorrection: Date;
      preferredClassification: boolean;
      confidence: number;
    };
  };
  amountPatterns: {
    lowAmount: { threshold: number; preferredClassification: boolean; confidence: number };
    highAmount: { threshold: number; preferredClassification: boolean; confidence: number };
  };
  lastUpdated: Date;
}

/** A learned merchant/category/MCC lean, surfaced to the analyst as context only. */
export interface PatternPreference {
  preferredClassification: boolean;
  confidence: number;
  correctionCount: number;
}

export interface AmountPreference {
  type: 'low' | 'high';
  preferredClassification: boolean;
  confidence: number;
}

// The key lives in a client-safe module so review components can group by it without firebase-admin.
export { learningMerchantKey };

/**
 * Corrections and pattern lookups never decide tax treatment on their own. The
 * former pattern-based helper that could auto-set `is_deductible` from
 * merchant/category preferences was removed; a server tax decision is required.
 */
export class AILearningEngine {
  private db = adminDb;

  /**
   * Record a user correction for learning
   */
  async recordCorrection(
    userId: string,
    transactionId: string,
    transactionData: any,
    originalAnalysis: any,
    userCorrection: { isDeductible: boolean; reasoning?: string }
  ): Promise<void> {
    try {
      const correctionId = `correction_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      const correction: UserCorrection = {
        id: correctionId,
        userId,
        transactionId,
        merchantName: String(transactionData.merchant_name || transactionData.merchant || transactionData.name || 'Unknown').trim() || 'Unknown',
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

      // Strip undefined values — Firestore rejects them
      const cleanCorrection = JSON.parse(JSON.stringify(correction));

      // Store correction in Firestore
      await this.db.collection('user_corrections').doc(correctionId).set(cleanCorrection);

      // Update learning patterns
      await this.updateLearningPatterns(userId, correction);

      console.log('✅ [AI Learning] Recorded correction');
    } catch {
      console.error('❌ [AI Learning] Error recording correction');
      throw new Error('Correction could not be recorded');
    }
  }

  /**
   * Get learning context for AI analysis
   */
  async getLearningContext(userId: string, transactionData: any): Promise<any> {
    try {
      const patterns = await this.getLearningPatterns(userId);
      if (!patterns) {
        return null;
      }

      const context = {
        merchantPreference: this.getMerchantPreference(patterns, learningMerchantKey(transactionData)),
        categoryPreference: this.getCategoryPreference(patterns, transactionData.category),
        mccPreference: this.getMccPreference(patterns, transactionData.mcc),
        amountPreference: this.getAmountPreference(patterns, transactionData.amount),
        overallConfidence: this.calculateOverallConfidence(patterns, transactionData)
      };

      return context;
    } catch (error) {
      console.error('❌ [AI Learning] Error getting learning context:', error);
      return null;
    }
  }

  /**
   * Get user's correction history for insights
   */
  async getCorrectionHistory(userId: string, limitCount: number = 50): Promise<UserCorrection[]> {
    try {
      const snapshot = await this.db
        .collection('user_corrections')
        .where('userId', '==', userId)
        .orderBy('timestamp', 'desc')
        .limit(limitCount)
        .get();

      return snapshot.docs.map(doc => doc.data() as UserCorrection);
    } catch (error) {
      console.error('❌ [AI Learning] Error getting correction history:', error);
      return [];
    }
  }

  /**
   * Get learning insights for user
   */
  async getLearningInsights(userId: string): Promise<any> {
    try {
      const corrections = await this.getCorrectionHistory(userId, 100);
      const patterns = await this.getLearningPatterns(userId);

      if (!patterns || corrections.length === 0) {
        return {
          totalCorrections: 0,
          accuracyImprovement: 0,
          topCorrectionReasons: [],
          learningProgress: 0
        };
      }

      const insights = {
        totalCorrections: corrections.length,
        accuracyImprovement: this.calculateAccuracyImprovement(corrections),
        topCorrectionReasons: this.getTopCorrectionReasons(corrections),
        learningProgress: this.calculateLearningProgress(patterns),
        merchantInsights: this.getMerchantInsights(patterns),
        categoryInsights: this.getCategoryInsights(patterns),
        recommendations: this.generateRecommendations(corrections, patterns)
      };

      return insights;
    } catch (error) {
      console.error('❌ [AI Learning] Error getting learning insights:', error);
      return null;
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

  private async updateLearningPatterns(userId: string, correction: UserCorrection): Promise<void> {
    try {
      const patternsRef = this.db.collection('learning_patterns').doc(userId);
      const patternsDoc = await patternsRef.get();
      
      const patterns: LearningPattern = patternsDoc.exists 
        ? patternsDoc.data() as LearningPattern
        : this.createEmptyPatterns(userId);

      const now = new Date();

      // Helper: update a single pattern entry with decay + conflict resolution
      function applyCorrection(
        entry: { correctionCount: number; lastCorrection: Date; preferredClassification: boolean; confidence: number } | undefined,
        newClassification: boolean,
        increment: number
      ) {
        if (!entry) {
          return {
            correctionCount: 1,
            lastCorrection: now,
            preferredClassification: newClassification,
            confidence: 0.5 + increment,
          };
        }

        // Decay confidence based on time since last correction (half-life ~90 days)
        const daysSinceLast = (now.getTime() - new Date(entry.lastCorrection).getTime()) / (1000 * 60 * 60 * 24);
        const decayFactor = Math.pow(0.5, daysSinceLast / 90);
        const decayedConfidence = 0.5 + (entry.confidence - 0.5) * decayFactor;

        if (entry.preferredClassification === newClassification) {
          // Reinforcement: boost confidence
          return {
            correctionCount: entry.correctionCount + 1,
            lastCorrection: now,
            preferredClassification: newClassification,
            confidence: Math.min(0.95, decayedConfidence + increment),
          };
        } else {
          // Contradiction: flip direction and reset confidence to slightly above neutral
          return {
            correctionCount: entry.correctionCount + 1,
            lastCorrection: now,
            preferredClassification: newClassification,
            confidence: Math.max(0.5, 0.5 + increment * 0.5),
          };
        }
      }

      // Update merchant patterns (same key as learningMerchantKey lookups)
      const merchantName = correction.merchantName.trim().toLowerCase();
      patterns.merchantPatterns[merchantName] = applyCorrection(
        patterns.merchantPatterns[merchantName],
        correction.userCorrection.isDeductible,
        0.1
      );

      // Update category patterns
      const category = correction.category.toLowerCase();
      patterns.categoryPatterns[category] = applyCorrection(
        patterns.categoryPatterns[category],
        correction.userCorrection.isDeductible,
        0.1
      );

      // Update MCC patterns if available
      if (correction.context.mcc) {
        patterns.mccPatterns[correction.context.mcc] = applyCorrection(
          patterns.mccPatterns[correction.context.mcc],
          correction.userCorrection.isDeductible,
          0.1
        );
      }

      // Update amount patterns (smaller increment — amount alone is weak signal)
      // Note: amountPatterns have a different shape (no correctionCount/lastCorrection)
      const amount = Math.abs(correction.context.amount);
      if (amount < patterns.amountPatterns.lowAmount.threshold) {
        const prev = patterns.amountPatterns.lowAmount;
        const sameDirection = prev.preferredClassification === correction.userCorrection.isDeductible;
        patterns.amountPatterns.lowAmount = {
          ...prev,
          preferredClassification: correction.userCorrection.isDeductible,
          confidence: sameDirection
            ? Math.min(0.95, prev.confidence + 0.05)
            : Math.max(0.5, 0.5 + 0.025),
        };
      } else if (amount > patterns.amountPatterns.highAmount.threshold) {
        const prev = patterns.amountPatterns.highAmount;
        const sameDirection = prev.preferredClassification === correction.userCorrection.isDeductible;
        patterns.amountPatterns.highAmount = {
          ...prev,
          preferredClassification: correction.userCorrection.isDeductible,
          confidence: sameDirection
            ? Math.min(0.95, prev.confidence + 0.05)
            : Math.max(0.5, 0.5 + 0.025),
        };
      }

      patterns.lastUpdated = now;
      const cleanPatterns = JSON.parse(JSON.stringify(patterns));
      await patternsRef.set(cleanPatterns);
    } catch (error) {
      console.error('❌ [AI Learning] Error updating learning patterns:', error);
    }
  }

  private createEmptyPatterns(userId: string): LearningPattern {
    return {
      userId,
      merchantPatterns: {},
      categoryPatterns: {},
      mccPatterns: {},
      amountPatterns: {
        lowAmount: { threshold: 50, preferredClassification: false, confidence: 0.5 },
        highAmount: { threshold: 500, preferredClassification: false, confidence: 0.5 }
      },
      lastUpdated: new Date()
    };
  }

  private async getLearningPatterns(userId: string): Promise<LearningPattern | null> {
    try {
      const patternsRef = this.db.collection('learning_patterns').doc(userId);
      const patternsDoc = await patternsRef.get();
      return patternsDoc.exists ? patternsDoc.data() as LearningPattern : null;
    } catch (error) {
      console.error('❌ [AI Learning] Error getting learning patterns:', error);
      return null;
    }
  }

  private getMerchantPreference(patterns: LearningPattern, merchantKey?: string): PatternPreference | null {
    if (!merchantKey) return null;
    const merchant = patterns.merchantPatterns[merchantKey.toLowerCase()];
    return merchant ? {
      preferredClassification: merchant.preferredClassification,
      confidence: merchant.confidence,
      correctionCount: merchant.correctionCount
    } : null;
  }

  private getCategoryPreference(patterns: LearningPattern, category?: string): PatternPreference | null {
    if (!category) return null;
    const cat = patterns.categoryPatterns[category.toLowerCase()];
    return cat ? {
      preferredClassification: cat.preferredClassification,
      confidence: cat.confidence,
      correctionCount: cat.correctionCount
    } : null;
  }

  private getMccPreference(patterns: LearningPattern, mcc?: string): PatternPreference | null {
    if (!mcc) return null;
    const mccPattern = patterns.mccPatterns[mcc];
    return mccPattern ? {
      preferredClassification: mccPattern.preferredClassification,
      confidence: mccPattern.confidence,
      correctionCount: mccPattern.correctionCount
    } : null;
  }

  private getAmountPreference(patterns: LearningPattern, amount?: number): AmountPreference | null {
    if (!amount) return null;
    const absAmount = Math.abs(amount);
    if (absAmount < patterns.amountPatterns.lowAmount.threshold) {
      return {
        type: 'low',
        preferredClassification: patterns.amountPatterns.lowAmount.preferredClassification,
        confidence: patterns.amountPatterns.lowAmount.confidence
      };
    } else if (absAmount > patterns.amountPatterns.highAmount.threshold) {
      return {
        type: 'high',
        preferredClassification: patterns.amountPatterns.highAmount.preferredClassification,
        confidence: patterns.amountPatterns.highAmount.confidence
      };
    }
    return null;
  }

  private calculateOverallConfidence(patterns: LearningPattern, transactionData: any): number {
    const preferences = [
      this.getMerchantPreference(patterns, learningMerchantKey(transactionData)),
      this.getCategoryPreference(patterns, transactionData.category),
      this.getMccPreference(patterns, transactionData.mcc),
      this.getAmountPreference(patterns, transactionData.amount)
    ].filter((p): p is PatternPreference | AmountPreference => p !== null);

    if (preferences.length === 0) return 0.5;

    const totalConfidence = preferences.reduce((sum, pref) => sum + pref.confidence, 0);
    return totalConfidence / preferences.length;
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

// Export singleton instance with lazy initialization
let _aiLearningEngine: AILearningEngine | null = null;

export const aiLearningEngine = {
  async recordCorrection(...args: Parameters<AILearningEngine['recordCorrection']>) {
    if (!_aiLearningEngine) {
      _aiLearningEngine = new AILearningEngine();
    }
    return _aiLearningEngine.recordCorrection(...args);
  },
  
  async getLearningContext(...args: Parameters<AILearningEngine['getLearningContext']>) {
    if (!_aiLearningEngine) {
      _aiLearningEngine = new AILearningEngine();
    }
    return _aiLearningEngine.getLearningContext(...args);
  },

  async getCorrectionHistory(...args: Parameters<AILearningEngine['getCorrectionHistory']>) {
    if (!_aiLearningEngine) {
      _aiLearningEngine = new AILearningEngine();
    }
    return _aiLearningEngine.getCorrectionHistory(...args);
  },
  
  async getLearningInsights(...args: Parameters<AILearningEngine['getLearningInsights']>) {
    if (!_aiLearningEngine) {
      _aiLearningEngine = new AILearningEngine();
    }
    return _aiLearningEngine.getLearningInsights(...args);
  }
};
