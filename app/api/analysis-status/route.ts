export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';
import { adminDb, FieldValue } from '@/lib/firebase/admin';

export async function GET(request: NextRequest) {
  try {
    // Get the authenticated user
    const { user, error: authError } = await getAuthenticatedUser(request);
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get query parameters
    const { searchParams } = new URL(request.url);
    const jobId = searchParams.get('jobId');

    if (jobId) {
      // Get specific analysis job
      const docRef = adminDb.collection('analysis_status').doc(jobId);
      const doc = await docRef.get();
      
      if (!doc.exists) {
        return NextResponse.json({ error: 'Analysis job not found' }, { status: 404 });
      }

      const data = doc.data();
      
      // Verify ownership
      if (data?.userId !== user.uid) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
      }

      return NextResponse.json({
        success: true,
        data: {
          jobId: doc.id,
          ...data
        }
      });
    } else {
      // Get all analysis jobs for the user
      const snapshot = await adminDb
        .collection('analysis_status')
        .where('userId', '==', user.uid)
        .orderBy('created_at', 'desc')
        .limit(10)
        .get();

      const jobs = snapshot.docs.map(doc => ({
        jobId: doc.id,
        ...doc.data()
      }));

      return NextResponse.json({
        success: true,
        data: jobs
      });
    }

  } catch (error) {
    console.error('Error in analysis status API:', error);
    return NextResponse.json(
      { error: 'Failed to fetch analysis status' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    // Get the authenticated user
    const { user, error: authError } = await getAuthenticatedUser(request);
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { total, status = 'running' } = body;

    if (!total || typeof total !== 'number') {
      return NextResponse.json({ error: 'Total is required and must be a number' }, { status: 400 });
    }

    // Create new analysis job with userId field
    const jobId = `analysis_${Date.now()}_${user.uid}`;
    const docRef = adminDb.collection('analysis_status').doc(jobId);
    
    await docRef.set({
      userId: user.uid,       // ← use userId (camelCase)
      total,
      completed: 0,
      status: 'running',
      created_at: FieldValue.serverTimestamp(),
      updated_at: FieldValue.serverTimestamp(),
    }, { merge: true });

    return NextResponse.json({
      success: true,
      data: {
        jobId,
        userId: user.uid,
        total,
        completed: 0,
        status: 'running'
      }
    });

  } catch (error) {
    console.error('Error creating analysis status:', error);
    return NextResponse.json(
      { error: 'Failed to create analysis status' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    // Get the authenticated user
    const { user, error: authError } = await getAuthenticatedUser(request);
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { jobId, completed, status } = body;

    if (!jobId) {
      return NextResponse.json({ error: 'Job ID is required' }, { status: 400 });
    }

    // Update analysis job
    const docRef = adminDb.collection('analysis_status').doc(jobId);
    const doc = await docRef.get();
    
    if (!doc.exists) {
      return NextResponse.json({ error: 'Analysis job not found' }, { status: 404 });
    }

    const data = doc.data();
    
    // Verify ownership
    if (data?.userId !== user.uid) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const updates: any = {
      updated_at: FieldValue.serverTimestamp()
    };

    if (completed !== undefined) {
      // Use increment for progress updates, direct value for final status
      updates.completed = typeof completed === 'number' && completed > 0 
        ? FieldValue.increment(1) 
        : completed;
    }
    if (status) {
      updates.status = status;
      // Add finished_at timestamp when status changes to 'done'
      if (status === 'done') {
        updates.finished_at = FieldValue.serverTimestamp();
      }
    }

    await docRef.update(updates);

    return NextResponse.json({
      success: true,
      data: {
        jobId,
        ...updates
      }
    });

  } catch (error) {
    console.error('Error updating analysis status:', error);
    return NextResponse.json(
      { error: 'Failed to update analysis status' },
      { status: 500 }
    );
  }
}
