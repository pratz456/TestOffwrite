import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "./firebase"; 

export async function createAccount(userId: string, accountId: string) {
  await setDoc(doc(db, "user_profiles", userId, "accounts", accountId), {
    account_id: accountId,
    name: "Chase Checking",
    mask: "1234",
    type: "depository",
    subtype: "checking",
    institution_id: "ins_12345",
    created_at: serverTimestamp(),
    updated_at: serverTimestamp()
  });
}
