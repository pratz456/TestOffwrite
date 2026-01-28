export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { adminAuth } from '@/lib/firebase/admin';
import { adminDb } from '@/lib/firebase/admin';
// Note: Firebase Storage client functions can't be used in server-side API routes
// For now, we'll use the legacy Firestore storage method
import { v4 as uuidv4 } from 'uuid';

export async function POST(request: NextRequest) {
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

    // Parse the form data
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const transactionId = formData.get('transactionId') as string;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    if (!transactionId) {
      return NextResponse.json({ error: 'No transaction ID provided' }, { status: 400 });
    }

    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'application/pdf'];
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json({ 
        error: 'Invalid file type. Please upload an image (JPG, PNG, GIF) or PDF file.' 
      }, { status: 400 });
    }

    // Validate file size (max 10MB)
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (file.size > maxSize) {
      return NextResponse.json({ 
        error: 'File too large. Please upload a file smaller than 10MB.' 
      }, { status: 400 });
    }

    // Generate unique filename
    const fileExtension = file.name.split('.').pop();
    const uniqueFilename = `${userId}/${transactionId}/${uuidv4()}.${fileExtension}`;

    // Convert file to buffer
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // For now, we'll store the file in a simple way
    // In production, you'd want to use a proper file storage service like AWS S3, Google Cloud Storage, etc.
    // For this demo, we'll create a base64 data URL
    const base64Data = buffer.toString('base64');
    const dataUrl = `data:${file.type};base64,${base64Data}`;

    // Store receipt info in Firestore
    const receiptData = {
      transactionId,
      userId,
      filename: file.name,
      originalName: file.name,
      mimeType: file.type,
      size: file.size,
      dataUrl: dataUrl, // In production, this would be a URL to the stored file
      uploadedAt: new Date(),
    };

    // Save to Firestore
    await adminDb.collection('receipts').doc(uniqueFilename).set(receiptData);

    // Return the receipt URL (in production, this would be the actual file URL)
    const receiptUrl = `/api/receipts/${uniqueFilename}`;

    return NextResponse.json({
      success: true,
      receiptUrl,
      filename: file.name,
      size: file.size,
    });

  } catch (error) {
    console.error('Error uploading receipt:', error);
    return NextResponse.json(
      { error: 'Failed to upload receipt' },
      { status: 500 }
    );
  }
}
