// Re-export from admin.ts to avoid duplicate initialization
export { adminAuth as auth, adminDb as db } from './admin';

// Server-side Firebase client
export async function createClient() {
  const { adminAuth, adminDb } = await import('./admin');
  return { auth: adminAuth, db: adminDb };
}
