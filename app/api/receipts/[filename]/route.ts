export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { adminAuth } from '@/lib/firebase/admin';
import { adminDb } from '@/lib/firebase/admin';
// Note: Firebase Storage client functions can't be used in server-side API routes
// We'll handle this differently for server-side usage

export async function GET(
  request: NextRequest,
  { params }: { params: { filename: string } }
) {
  try {
    // Get the authorization header
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const token = authHeader.split('Bearer ')[1];
    
    // Verify the Firebase token
    const decodedToken = await adminAuth.verifyIdToken(token);
    const userId = decodedToken.uid;

    const filename = params.filename;

    // For new Firebase Storage receipts, the filename is actually the storage path
    // Format: receipts/{userId}/{transactionId}/{filename}
    // For backward compatibility, check if it's a storage path or old Firestore document ID
    
    if (filename.startsWith('receipts/')) {
      // New Firebase Storage path - for now, return a message to use direct Storage URL
      // In production, you would generate a signed URL using Firebase Admin SDK
      return NextResponse.json({ 
        error: 'Receipt stored in Firebase Storage',
        message: 'Please use the direct Firebase Storage URL provided in the transaction data',
        storagePath: filename
      }, { status: 200 });
    } else {
      // Legacy: Check old Firestore receipts collection for backward compatibility
      const receiptDoc = await adminDb.collection('receipts').doc(filename).get();
      
      if (!receiptDoc.exists) {
        return NextResponse.json({ error: 'Receipt not found' }, { status: 404 });
      }

      const receiptData = receiptDoc.data();
      
      // Verify the user owns this receipt
      if (receiptData?.userId !== userId) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
      }

      // Return the receipt data (legacy base64 format)
      if (receiptData?.dataUrl) {
        // For base64 data URLs, we need to extract the data and return it as a proper response
        const base64Data = receiptData.dataUrl.split(',')[1];
        const buffer = Buffer.from(base64Data, 'base64');
        
        return new NextResponse(buffer, {
          headers: {
            'Content-Type': receiptData.mimeType || 'application/octet-stream',
            'Content-Disposition': `inline; filename="${receiptData.originalName}"`,
            'Cache-Control': 'public, max-age=31536000', // Cache for 1 year
          },
        });
      }

      return NextResponse.json({ error: 'Receipt data not found' }, { status: 404 });
    }

  } catch (error) {
    console.error('Error retrieving receipt:', error);
    return NextResponse.json(
      { error: 'Failed to retrieve receipt' },
      { status: 500 }
    );
  }
}
