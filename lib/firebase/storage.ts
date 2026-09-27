import { getStorage, connectStorageEmulator } from 'firebase/storage';
import { app, localEmulatorConfig } from './client';
import { connectLocalEmulatorOnce } from './local-emulator-config';

// Initialize Firebase Storage
export const storage = (() => {
  const instance = getStorage(app);
  const config = localEmulatorConfig;
  if (config) connectLocalEmulatorOnce(instance, 'storage', config, () => connectStorageEmulator(instance, config.host, config.storagePort));
  return instance;
})();

/**
 * Upload a receipt file to Firebase Storage
 * @param file - The file to upload
 * @param userId - User ID for path organization
 * @param transactionId - Transaction ID for path organization
 * @returns Promise with download URL and file path
 */
export async function uploadReceiptToStorage(
  _file: File,
  _userId: string,
  _transactionId: string,
): Promise<{ downloadURL: string; filePath: string }> {
  throw new Error('Direct receipt Storage access is disabled. Use the authenticated receipt API.');
}

/**
 * Get a download URL for a receipt file
 * @param filePath - The storage path of the file
 * @returns Promise with download URL
 */
export async function getReceiptDownloadUrl(_filePath: string): Promise<string> {
  throw new Error('Direct receipt Storage access is disabled. Use the authenticated receipt API.');
}

/**
 * Delete a receipt file from Firebase Storage
 * @param filePath - The storage path of the file to delete
 */
export async function deleteReceiptFromStorage(_filePath: string): Promise<void> {
  throw new Error('Direct receipt Storage access is disabled. Use the authenticated receipt API.');
}

/**
 * Get file metadata from Firebase Storage
 * @param filePath - The storage path of the file
 * @returns Promise with file metadata
 */
export async function getReceiptMetadata(_filePath: string): Promise<never> {
  throw new Error('Direct receipt Storage access is disabled. Use the authenticated receipt API.');
}

/**
 * Generate a signed URL for temporary access (if needed)
 * Note: This requires Firebase Admin SDK on the server side
 * For client-side usage, use getDownloadURL instead
 */
export async function generateSignedUrl(_filePath: string, _expiresIn: number = 3600): Promise<string> {
  throw new Error('Client-side signed receipt URLs are disabled. Use the authenticated receipt API.');
}
