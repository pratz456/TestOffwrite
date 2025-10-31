import { doc, getDoc, setDoc, updateDoc, increment } from 'firebase/firestore';
import { db } from './client';

export interface ProgressData {
  completedPages: number;
  totalPages: number;
  answered: Record<string, 'deductible' | 'personal'>;
}

export async function updateProgress(
  userId: string, 
  pageId: string, 
  choice: 'deductible' | 'personal'
): Promise<void> {
  try {
    // Use the existing user_profiles collection structure that has proper permissions
    const progressRef = doc(db, "user_profiles", userId, "meta", "progress");
    
    // Get current progress
    const progressDoc = await getDoc(progressRef);
    
    if (!progressDoc.exists()) {
      // Initialize progress document
      const initialProgress: ProgressData = {
        completedPages: 1,
        totalPages: 0, // Will be set by the calling component
        answered: { [pageId]: choice }
      };
      
      await setDoc(progressRef, initialProgress);
      console.log('✅ Progress initialized for user:', userId);
      return;
    }
    
    const currentProgress = progressDoc.data() as ProgressData;
    const wasAlreadyAnswered = currentProgress.answered[pageId];
    
    // Only increment if this page wasn't previously answered
    if (!wasAlreadyAnswered) {
      const updates: any = {
        completedPages: increment(1),
        [`answered.${pageId}`]: choice
      };
      
      await updateDoc(progressRef, updates);
      console.log('✅ Progress updated for user:', userId, 'page:', pageId, 'choice:', choice);
    } else {
      // Update choice if it changed, but don't increment count
      await updateDoc(progressRef, {
        [`answered.${pageId}`]: choice
      });
      console.log('✅ Choice updated for user:', userId, 'page:', pageId, 'choice:', choice);
    }
    
  } catch (error) {
    console.error('❌ Error updating progress:', error);
    throw error;
  }
}

export async function setTotalPages(userId: string, totalPages: number): Promise<void> {
  try {
    // Use the existing user_profiles collection structure that has proper permissions
    const progressRef = doc(db, "user_profiles", userId, "meta", "progress");
    
    const progressDoc = await getDoc(progressRef);
    
    if (!progressDoc.exists()) {
      // Initialize with total pages
      const initialProgress: ProgressData = {
        completedPages: 0,
        totalPages,
        answered: {}
      };
      
      await setDoc(progressRef, initialProgress);
    } else {
      // Update total pages
      await updateDoc(progressRef, { totalPages });
    }
    
    console.log('✅ Total pages set for user:', userId, 'total:', totalPages);
  } catch (error) {
    console.error('❌ Error setting total pages:', error);
    throw error;
  }
}

export async function getProgress(userId: string): Promise<ProgressData | null> {
  try {
    // Use the existing user_profiles collection structure that has proper permissions
    const progressRef = doc(db, "user_profiles", userId, "meta", "progress");
    const progressDoc = await getDoc(progressRef);
    
    if (progressDoc.exists()) {
      return progressDoc.data() as ProgressData;
    }
    
    return null;
  } catch (error) {
    console.error('❌ Error getting progress:', error);
    return null;
  }
}
