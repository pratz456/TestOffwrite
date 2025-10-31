import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "./firebase"; 

export async function createTransaction(userId: string, accountId: string, transId: string) {
  await setDoc(doc(db, "user_profiles", userId, "accounts", accountId, "transactions", transId), {
    trans_id: transId,
    date: "2025-08-27",
    amount: 120.75,
    merchant_name: "Amazon",
    category: "Shopping",
    is_deductible: false,
    deduction_score: null,

    notes: "Work expense",
    created_at: serverTimestamp(),
    updated_at: serverTimestamp()
  });
}
