export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';
import { generateUserDataExport, generateDataPackage, validateExportData } from '@/lib/reports/data-export';
import { adminDb } from '@/lib/firebase/admin';

// Rate limiting: 1 export per hour per user
const EXPORT_RATE_LIMIT = 60 * 60 * 1000; // 1 hour in milliseconds
const rateLimitMap = new Map<string, number>();

/**
 * Check if user can request export (rate limiting)
 */
function canRequestExport(userId: string): boolean {
  const lastExport = rateLimitMap.get(userId);
  const now = Date.now();
  
  if (!lastExport) {
    return true;
  }
  
  return (now - lastExport) >= EXPORT_RATE_LIMIT;
}

/**
 * Record export request for rate limiting
 */
function recordExportRequest(userId: string): void {
  rateLimitMap.set(userId, Date.now());
}

/**
 * Log export request for audit trail
 */
async function logExportRequest(userId: string, exportId: string): Promise<void> {
  try {
    await adminDb.collection('export_logs').add({
      userId,
      exportId,
      requestedAt: new Date(),
      ipAddress: 'unknown', // Could be extracted from request headers
      userAgent: 'unknown'  // Could be extracted from request headers
    });
  } catch (error) {
    console.warn('⚠️ [Export API] Failed to log export request:', error);
    // Don't fail the export if logging fails
  }
}

export async function POST(request: NextRequest) {
  try {
    // Get the authenticated user
    const { user, error: authError } = await getAuthenticatedUser(request);
    
    if (authError || !user) {
      console.error('❌ [Export API] Authentication failed:', authError);
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log(`📊 [Export API] Export request from user: ${user.uid}`);

    // Check rate limiting
    if (!canRequestExport(user.uid)) {
      const lastExport = rateLimitMap.get(user.uid);
      const timeRemaining = Math.ceil((EXPORT_RATE_LIMIT - (Date.now() - lastExport!)) / 1000 / 60);
      
      return NextResponse.json({
        error: 'Rate limit exceeded',
        message: `You can only export your data once per hour. Please wait ${timeRemaining} minutes.`,
        retryAfter: timeRemaining * 60 // seconds
      }, { status: 429 });
    }

    // Record the export request
    recordExportRequest(user.uid);

    // Generate the data export
    console.log(`🔄 [Export API] Generating data export for user: ${user.uid}`);
    const userData = await generateUserDataExport(user.uid);
    
    // Validate the export data
    const validation = validateExportData(userData);
    if (!validation.isValid) {
      console.error('❌ [Export API] Export validation failed:', validation.errors);
      return NextResponse.json({
        error: 'Export validation failed',
        details: validation.errors
      }, { status: 500 });
    }

    // Log warnings if any
    if (validation.warnings.length > 0) {
      console.warn('⚠️ [Export API] Export warnings:', validation.warnings);
    }

    // Generate the data package
    const dataPackage = generateDataPackage(userData);
    
    // Log the export request for audit trail
    await logExportRequest(user.uid, userData.exportInfo.exportId);

    console.log(`✅ [Export API] Export completed for user: ${user.uid}`, {
      exportId: userData.exportInfo.exportId,
      transactionCount: userData.transactions.length,
      accountCount: userData.accounts.length,
      receiptCount: userData.receipts.length
    });

    // Return the export data
    return NextResponse.json({
      success: true,
      exportId: userData.exportInfo.exportId,
      exportDate: userData.exportInfo.exportDate,
      data: dataPackage,
      summary: {
        accounts: userData.accounts.length,
        transactions: userData.transactions.length,
        receipts: userData.receipts.length,
        aiAnalysis: userData.aiAnalysis.length
      },
      warnings: validation.warnings
    });

  } catch (error) {
    console.error('❌ [Export API] Export failed:', error);
    
    return NextResponse.json({
      error: 'Export failed',
      message: error instanceof Error ? error.message : 'Unknown error occurred',
      details: process.env.NODE_ENV === 'development' ? String(error) : undefined
    }, { status: 500 });
  }
}

/**
 * GET endpoint to check export status and rate limiting
 */
export async function GET(request: NextRequest) {
  try {
    // Get the authenticated user
    const { user, error: authError } = await getAuthenticatedUser(request);
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const canExport = canRequestExport(user.uid);
    const lastExport = rateLimitMap.get(user.uid);
    
    let timeRemaining = 0;
    if (lastExport && !canExport) {
      timeRemaining = Math.ceil((EXPORT_RATE_LIMIT - (Date.now() - lastExport)) / 1000 / 60);
    }

    return NextResponse.json({
      canExport,
      timeRemaining,
      rateLimitHours: EXPORT_RATE_LIMIT / (1000 * 60 * 60)
    });

  } catch (error) {
    console.error('❌ [Export API] Status check failed:', error);
    return NextResponse.json({ error: 'Status check failed' }, { status: 500 });
  }
}