import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "./firebase"; 

export async function createUserProfile(userId: string, profileData: any = {}) {
  const defaultProfile = {
    user_id: userId, // Ensure user_id is set
    userId: userId,  // Also set userId for compatibility
    email: profileData.email || "user@example.com",
    name: profileData.name || "User",
    profession: profileData.profession || "Professional",
    income: profileData.income || 0,
    state: profileData.state || "CA",
    filing_status: profileData.filing_status || "single",
    created_at: serverTimestamp(),
    updated_at: serverTimestamp()
  };

  try {
    console.log(`🔄 [Profile] Creating user profile for: ${userId}`);
    await setDoc(doc(db, "user_profiles", userId), defaultProfile, { merge: true });
    console.log(`✅ [Profile] Successfully created profile for: ${userId}`);
    return { success: true, data: defaultProfile };
  } catch (error: any) {
    console.error(`❌ [Profile] Failed to create profile for ${userId}:`, error);
    return { success: false, error: error.message };
  }
}
