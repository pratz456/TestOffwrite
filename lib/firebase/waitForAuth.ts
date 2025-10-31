import { onAuthStateChanged, getAuth } from 'firebase/auth';
import { app } from './client';

export function waitForAuth(): Promise<string> {
  const auth = getAuth(app);
  return new Promise((resolve, reject) => {
    const unsub = onAuthStateChanged(auth, (user) => {
      unsub();
      if (user?.uid) resolve(user.uid);
      else reject(new Error('Not signed in'));
    }, reject);
  });
}
