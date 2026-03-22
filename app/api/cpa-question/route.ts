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

    // Send email notification to WriteOff team
    try {
      const emailBody = [
        `New CPA Question (ID: ${docRef.id})`,
        ``,
        `From: ${decodedToken.name || 'Unknown'} (${decodedToken.email || userId})`,
        `Date: ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })}`,
        ``,
        `Transaction: ${merchantName}`,
        `Amount: $${parseFloat(amount).toFixed(2)}`,
        `Category: ${category}`,
        `Transaction Date: ${date}`,
        ``,
        `Question:`,
        `${question.trim()}`,
        ``,
        `---`,
        `View in Firestore: https://console.firebase.google.com/project/${process.env.FIREBASE_ADMIN_PROJECT_ID}/firestore/data/cpa_questions/${docRef.id}`,
      ].join('\n');

      // Use Resend if available, otherwise log for manual review
      if (process.env.RESEND_API_KEY) {
        const resendRes = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: 'WriteOff Notifications <notifications@writeoffapp.com>',
            to: ['writeoffapp@gmail.com'],
            subject: `CPA Question: ${merchantName} ($${parseFloat(amount).toFixed(2)}) - ${decodedToken.name || decodedToken.email || 'User'}`,
            text: emailBody,
          }),
        });
        if (!resendRes.ok) {
          console.error('Failed to send CPA email notification:', await resendRes.text());
        }
      } else {
        // Fallback: use mailto-style logging so questions aren't lost
        console.log(`📧 CPA Question Email (RESEND_API_KEY not set):\nTo: writeoffapp@gmail.com\n${emailBody}`);
      }
    } catch (emailErr) {
      // Don't fail the request if email fails
      console.error('Email notification error (non-blocking):', emailErr);
    }

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