import { getStorage, ref, uploadBytes, getDownloadURL, deleteObject, getMetadata } from 'firebase/storage';
import { app } from './client';

// Initialize Firebase Storage
export const storage = getStorage(app);

/**
 * Upload a receipt file to Firebase Storage
 * @param file - The file to upload
 * @param userId - User ID for path organization
 * @param transactionId - Transaction ID for path organization
 * @returns Promise with download URL and file path
 */
export async function uploadReceiptToStorage(
  file: File, 
  userId: string, 
  transactionId: string
): Promise<{ downloadURL: string; filePath: string }> {
  try {
    // Create storage path: receipts/{userId}/{transactionId}/{filename}
    const fileExtension = file.name.split('.').pop() || 'bin';
    const timestamp = Date.now();
    const fileName = `${timestamp}_${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
    const filePath = `receipts/${userId}/${transactionId}/${fileName}`;
    
    // Create storage reference
    const storageRef = ref(storage, filePath);
    
    // Convert file to buffer for upload
    const bytes = await file.arrayBuffer();
    const buffer = new Uint8Array(bytes);
    
    // Upload file to Firebase Storage
    const uploadResult = await uploadBytes(storageRef, buffer, {
      contentType: file.type,
      customMetadata: {
        originalName: file.name,
        uploadedAt: new Date().toISOString(),
        userId,
        transactionId
      }
    });
    
    // Get download URL
    const downloadURL = await getDownloadURL(uploadResult.ref);
    
    console.log(`✅ [Storage] Successfully uploaded receipt: ${filePath}`);
    
    return {
      downloadURL,
      filePath
    };
  } catch (error) {
    console.error('❌ [Storage] Failed to upload receipt:', error);
    throw new Error(`Failed to upload receipt: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Get a download URL for a receipt file
 * @param filePath - The storage path of the file
 * @returns Promise with download URL
 */
export async function getReceiptDownloadUrl(filePath: string): Promise<string> {
  try {
    const storageRef = ref(storage, filePath);
    const downloadURL = await getDownloadURL(storageRef);
    return downloadURL;
  } catch (error) {
    console.error('❌ [Storage] Failed to get download URL:', error);
    throw new Error(`Failed to get download URL: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Delete a receipt file from Firebase Storage
 * @param filePath - The storage path of the file to delete
 */
export async function deleteReceiptFromStorage(filePath: string): Promise<void> {
  try {
    const storageRef = ref(storage, filePath);
    await deleteObject(storageRef);
    console.log(`✅ [Storage] Successfully deleted receipt: ${filePath}`);
  } catch (error) {
    console.error('❌ [Storage] Failed to delete receipt:', error);
    throw new Error(`Failed to delete receipt: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Get file metadata from Firebase Storage
 * @param filePath - The storage path of the file
 * @returns Promise with file metadata
 */
export async function getReceiptMetadata(filePath: string): Promise<any> {
  try {
    const storageRef = ref(storage, filePath);
    const metadata = await getMetadata(storageRef);
    return metadata;
  } catch (error) {
    console.error('❌ [Storage] Failed to get file metadata:', error);
    throw new Error(`Failed to get file metadata: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Generate a signed URL for temporary access (if needed)
 * Note: This requires Firebase Admin SDK on the server side
 * For client-side usage, use getDownloadURL instead
 */
export async function generateSignedUrl(filePath: string, expiresIn: number = 3600): Promise<string> {
  // This would typically be implemented on the server side
  // For now, we'll use the regular download URL
  return getReceiptDownloadUrl(filePath);
}
