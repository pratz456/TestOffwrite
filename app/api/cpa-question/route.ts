export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebase/admin';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId, transactionId, merchantName, amount, date, category, question } = body;

    // Validate required fields
    if (!userId || !transactionId || !merchantName || !amount || !date || !category || !question) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Verify user authentication
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const token = authHeader.split('Bearer ')[1];
    let decodedToken;
    try {
      decodedToken = await adminAuth.verifyIdToken(token);
    } catch (error) {
      return NextResponse.json(
        { error: 'Invalid token' },
        { status: 401 }
      );
    }

    if (decodedToken.uid !== userId) {
      return NextResponse.json(
        { error: 'User ID mismatch' },
        { status: 403 }
      );
    }

    // Create CPA question document
    const cpaQuestionData = {
      userId,
      transactionId,
      merchantName,
      amount: parseFloat(amount),
      date,
      category,
      question: question.trim(),
      status: 'pending', // pending, in_review, answered
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      // Additional metadata
      userEmail: decodedToken.email || '',
      userName: decodedToken.name || '',
    };

    // Save to Firestore
    const docRef = await adminDb.collection('cpa_questions').add(cpaQuestionData);

    // TODO: Send notification to CPA team (email, Slack, etc.)
    // This could be implemented with:
    // - Email service (SendGrid, AWS SES)
    // - Slack webhook
    // - Internal notification system

    console.log(`New CPA question submitted: ${docRef.id} for user ${userId}`);

    return NextResponse.json({
      success: true,
      questionId: docRef.id,
      message: 'Question submitted successfully'
    });

  } catch (error) {
    console.error('Error submitting CPA question:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    // Get user's CPA questions
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');

    if (!userId) {
      return NextResponse.json(
        { error: 'User ID required' },
        { status: 400 }
      );
    }

    // Verify authentication
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const token = authHeader.split('Bearer ')[1];
    let decodedToken;
    try {
      decodedToken = await adminAuth.verifyIdToken(token);
    } catch (error) {
      return NextResponse.json(
        { error: 'Invalid token' },
        { status: 401 }
      );
    }

    if (decodedToken.uid !== userId) {
      return NextResponse.json(
        { error: 'User ID mismatch' },
        { status: 403 }
      );
    }

    // Fetch user's CPA questions
    const questionsSnapshot = await adminDb
      .collection('cpa_questions')
      .where('userId', '==', userId)
      .orderBy('createdAt', 'desc')
      .get();

    const questions = questionsSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    return NextResponse.json({
      success: true,
      questions
    });

  } catch (error) {
    console.error('Error fetching CPA questions:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}