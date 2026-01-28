export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { adminDb } from '@/lib/firebase/admin';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';
import { getUserFromReqOrThrow } from '@/app/api/_lib/auth';

// Category mapping to Schedule C line items
const CATEGORY_MAP: { [key: string]: { line: string; name: string; code: string } } = {
  // Meals
  'FOOD_AND_DRINK_COFFEE_SHOP': { line: '24b', name: 'Meals', code: '24b' },
  'FOOD_AND_DRINK_FAST_FOOD': { line: '24b', name: 'Meals', code: '24b' },
  'FOOD_AND_DRINK_RESTAURANT': { line: '24b', name: 'Meals', code: '24b' },
  'FOOD_AND_DRINK_ALCOHOL_AND_BARS': { line: '24b', name: 'Meals', code: '24b' },

  // Office expense
  'GENERAL_MERCHANDISE_OFFICE_SUPPLIES': { line: '18', name: 'Office expense', code: '18' },
  'GENERAL_MERCHANDISE_COMPUTERS_AND_ELECTRONICS': { line: '18', name: 'Office expense', code: '18' },
  'GENERAL_MERCHANDISE_HOME_IMPROVEMENT': { line: '18', name: 'Office expense', code: '18' },
  'GENERAL_MERCHANDISE_PHARMACY': { line: '18', name: 'Office expense', code: '18' },
  'GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE': { line: '18', name: 'Office expense', code: '18' },
  'SERVICE_SHIPPING': { line: '18', name: 'Office expense', code: '18' },
  'SERVICE_UTILITIES': { line: '18', name: 'Office expense', code: '18' },
  'SERVICE_STORAGE': { line: '18', name: 'Office expense', code: '18' },

  // Professional services
  'SERVICE_ACCOUNTING': { line: '17', name: 'Legal and professional services', code: '17' },
  'SERVICE_CONSULTING': { line: '17', name: 'Legal and professional services', code: '17' },
  'SERVICE_LEGAL': { line: '17', name: 'Legal and professional services', code: '17' },
  'SERVICE_MARKETING': { line: '17', name: 'Legal and professional services', code: '17' },
  'SERVICE_ADVERTISING': { line: '17', name: 'Legal and professional services', code: '17' },
  'SERVICE_SECURITY': { line: '17', name: 'Legal and professional services', code: '17' },
  'SERVICE_INSURANCE': { line: '17', name: 'Legal and professional services', code: '17' },

  // Car and truck expenses
  'TRANSPORTATION_RIDESHARE': { line: '9', name: 'Car and truck expenses', code: '9' },
  'TRANSPORTATION_AUTO_PARKING': { line: '9', name: 'Car and truck expenses', code: '9' },
  'TRANSPORTATION_AUTO_REPAIR': { line: '9', name: 'Car and truck expenses', code: '9' },
  'TRANSPORTATION_AUTO_SERVICE': { line: '9', name: 'Car and truck expenses', code: '9' },
  'TRANSPORTATION_FUEL': { line: '9', name: 'Car and truck expenses', code: '9' },
  'TRANSPORTATION_TOLLS': { line: '9', name: 'Car and truck expenses', code: '9' },
  'TRANSPORTATION_AUTO_INSURANCE': { line: '9', name: 'Car and truck expenses', code: '9' },

  // Travel
  'TRAVEL_FLIGHTS': { line: '24a', name: 'Travel', code: '24a' },
  'TRAVEL_LODGING': { line: '24a', name: 'Travel', code: '24a' },
  'TRAVEL_OTHER_TRAVEL': { line: '24a', name: 'Travel', code: '24a' },

  // Other expenses
  'ENTERTAINMENT_SPORTS_AND_OUTDOORS': { line: '27a', name: 'Other expenses', code: '27a' },
  'ENTERTAINMENT_ARTS': { line: '27a', name: 'Other expenses', code: '27a' },
  'ENTERTAINMENT_THEATER': { line: '27a', name: 'Other expenses', code: '27a' },
  'ENTERTAINMENT_MUSIC': { line: '27a', name: 'Other expenses', code: '27a' },
  'ENTERTAINMENT_MOVIES_AND_DVDS': { line: '27a', name: 'Other expenses', code: '27a' },
  'GENERAL_MERCHANDISE_SPORTING_GOODS': { line: '27a', name: 'Other expenses', code: '27a' },
  'PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS': { line: '27a', name: 'Other expenses', code: '27a' },
  'COMMUNITY_CHARITY': { line: '27a', name: 'Other expenses', code: '27a' },
  'COMMUNITY_EDUCATION': { line: '27a', name: 'Other expenses', code: '27a' },
  'COMMUNITY_RELIGIOUS': { line: '27a', name: 'Other expenses', code: '27a' },
};

interface Transaction {
  id: string;
  merchant_name: string;
  amount: number;
  category: string;
  date: string;
  type?: 'expense' | 'income';
  is_deductible?: boolean | null;
  deductible_reason?: string;
  deduction_score?: number;
  description?: string;
  notes?: string;
}

interface LineItemSummary {
  lineCode: string;
  lineName: string;
  total: number;
  deductible: number;
  transactionCount: number;
  transactions: Transaction[];
}

export async function POST(request: NextRequest) {
  try {
    // Get the authenticated user (support Authorization header or session cookie)
    let uid: string | null = null;
    try {
      const { uid: headerUid } = await getUserFromReqOrThrow(request);
      uid = headerUid;
    } catch (headerAuthError) {
      const { user, error: authError } = await getAuthenticatedUser(request);
      if (authError || !user) {
        console.warn('⚠️ [Schedule C Export] Authentication failed:', headerAuthError || authError);
        return NextResponse.json(
          { error: 'Unauthorized' },
          { status: 401 }
        );
      }
      uid = user.uid;
    }

    const { year } = await request.json();

    if (!year) {
      return NextResponse.json(
        { error: 'Year is required' },
        { status: 400 }
      );
    }

    // Fetch transactions for the given year using Firebase
    const allTransactions: Transaction[] = [];

    try {
      // Use collectionGroup query to get all transactions for this user
      const transactionsQuery = adminDb.collectionGroup('transactions')
        .where('user_id', '==', uid);

      const querySnapshot = await transactionsQuery.get();
      console.log(`📊 [Schedule C Export] Found ${querySnapshot.size} transactions for user ${uid}`);

      querySnapshot.forEach((doc) => {
        const data = doc.data();
        allTransactions.push({
          id: data.trans_id || doc.id,
          merchant_name: data.merchant_name || '',
          amount: data.amount || 0,
          category: data.category || '',
          date: data.date || '',
          type: data.amount < 0 ? 'income' : 'expense',
          is_deductible: data.is_deductible,
          deductible_reason: data.deductible_reason,
          deduction_score: data.deduction_score,
          description: data.description,
          notes: data.notes,
        });
      });

      // Sort transactions by date in descending order
      allTransactions.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    } catch (collectionGroupError: unknown) {
      console.warn('⚠️ [Schedule C Export] CollectionGroup query failed, trying fallback method:', collectionGroupError);

      // Fallback: Try to get transactions from individual accounts
      try {
        const accountsSnapshot = await adminDb.collection('user_profiles').doc(uid).collection('accounts').get();
        console.log(`📊 [Schedule C Export] Found ${accountsSnapshot.size} accounts for user ${uid}`);

        for (const accountDoc of accountsSnapshot.docs) {
          const transactionsSnapshot = await adminDb.collection('user_profiles').doc(uid)
            .collection('accounts').doc(accountDoc.id)
            .collection('transactions').get();

          console.log(`📊 [Schedule C Export] Found ${transactionsSnapshot.size} transactions for account ${accountDoc.id}`);

          transactionsSnapshot.forEach((doc) => {
            const data = doc.data();
            allTransactions.push({
              id: data.trans_id || doc.id,
              merchant_name: data.merchant_name || '',
              amount: data.amount || 0,
              category: data.category || '',
              date: data.date || '',
              type: data.amount < 0 ? 'income' : 'expense',
              is_deductible: data.is_deductible,
              deductible_reason: data.deductible_reason,
              deduction_score: data.deduction_score,
              description: data.description,
              notes: data.notes,
            });
          });
        }
      } catch (fallbackError) {
        console.error('❌ [Schedule C Export] Fallback method also failed:', fallbackError);
        throw new Error('Failed to fetch transactions from database');
      }
    }

    const transactions = allTransactions;
    console.log(`📊 [Schedule C Export] Total transactions fetched: ${transactions.length}`);

    // Filter transactions for the specified year and user
    const yearTransactions = transactions.filter((t: Transaction) => {
      const transactionYear = new Date(t.date).getFullYear().toString();
      return transactionYear === year.toString();
    });
    console.log(`📊 [Schedule C Export] Transactions for year ${year}: ${yearTransactions.length}`);

    // Filter for deductible transactions (confirmed and potential business categories)
    const deductibleTransactions = yearTransactions.filter((t: Transaction) => {
      if (t.is_deductible === true) return true;

      // Include potentially deductible transactions (business categories where is_deductible is null)
      if (t.is_deductible === null && CATEGORY_MAP[t.category]) {
        return t.amount > 0; // Only expenses, not income
      }

      return false;
    });
    console.log(`📊 [Schedule C Export] Deductible transactions: ${deductibleTransactions.length}`);
    console.log(`📊 [Schedule C Export] Sample deductible transactions:`, deductibleTransactions.slice(0, 3).map(t => ({
      merchant: t.merchant_name,
      category: t.category,
      amount: t.amount,
      is_deductible: t.is_deductible
    })));

    // Group transactions by Schedule C line items
    const lineItems: { [key: string]: LineItemSummary } = {};

    deductibleTransactions.forEach(transaction => {
      const categoryInfo = CATEGORY_MAP[transaction.category];
      const lineKey = categoryInfo ? categoryInfo.line : '27a'; // Default to Other expenses

      if (!lineItems[lineKey]) {
        lineItems[lineKey] = {
          lineCode: lineKey,
          lineName: categoryInfo ? categoryInfo.name : 'Other expenses',
          total: 0,
          deductible: 0,
          transactionCount: 0,
          transactions: []
        };
      }

      const amount = Math.abs(transaction.amount);
      lineItems[lineKey].total += amount;
      lineItems[lineKey].transactionCount += 1;
      lineItems[lineKey].transactions.push(transaction);

      // Apply 50% rule for meals
      if (lineKey === '24b') {
        lineItems[lineKey].deductible += amount * 0.5;
      } else {
        lineItems[lineKey].deductible += amount;
      }
    });

    // Convert to array and sort by line code
    const lineItemsArray = Object.values(lineItems).sort((a, b) => {
      const aNum = parseInt(a.lineCode.replace(/\D/g, ''));
      const bNum = parseInt(b.lineCode.replace(/\D/g, ''));
      return aNum - bNum;
    });

    // Calculate totals
    const totalExpenses = lineItemsArray.reduce((sum, item) => sum + item.total, 0);
    const totalDeductible = lineItemsArray.reduce((sum, item) => sum + item.deductible, 0);

    // Generate PDF
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([612, 792]); // Standard US Letter size
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const pageWidth = page.getWidth();
    const pageHeight = page.getHeight();
    const margin = 50;
    let yPosition = pageHeight - margin;

    // Header
    page.drawText('Schedule C Summary', {
      x: margin,
      y: yPosition,
      size: 24,
      font: boldFont,
      color: rgb(0, 0, 0)
    });
    yPosition -= 40;

    page.drawText(`Tax Year: ${year}`, {
      x: margin,
      y: yPosition,
      size: 14,
      font: font,
      color: rgb(0, 0, 0)
    });
    yPosition -= 30;

    page.drawText(`Generated: ${new Date().toLocaleDateString()}`, {
      x: margin,
      y: yPosition,
      size: 12,
      font: font,
      color: rgb(0.5, 0.5, 0.5)
    });
    yPosition -= 40;

    // Summary table header
    page.drawText('Schedule C Line Items', {
      x: margin,
      y: yPosition,
      size: 16,
      font: boldFont,
      color: rgb(0, 0, 0)
    });
    yPosition -= 30;

    // Table headers
    const col1 = margin;
    const col2 = margin + 80;
    const col3 = margin + 300;
    const col4 = margin + 450;

    page.drawText('Line', {
      x: col1,
      y: yPosition,
      size: 12,
      font: boldFont,
      color: rgb(0, 0, 0)
    });

    page.drawText('Description', {
      x: col2,
      y: yPosition,
      size: 12,
      font: boldFont,
      color: rgb(0, 0, 0)
    });

    page.drawText('Total Amount', {
      x: col3,
      y: yPosition,
      size: 12,
      font: boldFont,
      color: rgb(0, 0, 0)
    });

    page.drawText('Deductible', {
      x: col4,
      y: yPosition,
      size: 12,
      font: boldFont,
      color: rgb(0, 0, 0)
    });

    yPosition -= 25;

    // Draw line separator
    page.drawLine({
      start: { x: margin, y: yPosition },
      end: { x: pageWidth - margin, y: yPosition },
      thickness: 1,
      color: rgb(0, 0, 0)
    });

    yPosition -= 20;

    // Line items
    let currentPage = page;
    lineItemsArray.forEach(item => {
      if (yPosition < margin + 100) {
        // Add new page if running out of space
        currentPage = pdfDoc.addPage([612, 792]);
        yPosition = currentPage.getHeight() - margin;
      }

      currentPage.drawText(item.lineCode, {
        x: col1,
        y: yPosition,
        size: 12,
        font: font,
        color: rgb(0, 0, 0)
      });

      currentPage.drawText(item.lineName, {
        x: col2,
        y: yPosition,
        size: 12,
        font: font,
        color: rgb(0, 0, 0)
      });

      currentPage.drawText(`$${item.total.toFixed(2)}`, {
        x: col3,
        y: yPosition,
        size: 12,
        font: font,
        color: rgb(0, 0, 0)
      });

      currentPage.drawText(`$${item.deductible.toFixed(2)}`, {
        x: col4,
        y: yPosition,
        size: 12,
        font: font,
        color: rgb(0, 0, 0)
      });

      yPosition -= 20;
    });

    yPosition -= 20;

    // Draw line separator
    page.drawLine({
      start: { x: margin, y: yPosition },
      end: { x: pageWidth - margin, y: yPosition },
      thickness: 1,
      color: rgb(0, 0, 0)
    });

    yPosition -= 20;

    // Totals
    page.drawText('Total Expenses:', {
      x: col2,
      y: yPosition,
      size: 14,
      font: boldFont,
      color: rgb(0, 0, 0)
    });

    page.drawText(`$${totalExpenses.toFixed(2)}`, {
      x: col3,
      y: yPosition,
      size: 14,
      font: boldFont,
      color: rgb(0, 0, 0)
    });

    page.drawText(`$${totalDeductible.toFixed(2)}`, {
      x: col4,
      y: yPosition,
      size: 14,
      font: boldFont,
      color: rgb(0, 0, 0)
    });

    yPosition -= 40;

    // Special sections
    if (lineItems['24b']) {
      page.drawText('Meals and Entertainment (Line 24b)', {
        x: margin,
        y: yPosition,
        size: 14,
        font: boldFont,
        color: rgb(0, 0, 0)
      });
      yPosition -= 20;

      page.drawText(`Total Meals: $${lineItems['24b'].total.toFixed(2)}`, {
        x: margin + 20,
        y: yPosition,
        size: 12,
        font: font,
        color: rgb(0, 0, 0)
      });
      yPosition -= 20;

      page.drawText(`Deductible (50%): $${lineItems['24b'].deductible.toFixed(2)}`, {
        x: margin + 20,
        y: yPosition,
        size: 12,
        font: font,
        color: rgb(0, 0, 0)
      });
      yPosition -= 30;
    }

    if (lineItems['27a']) {
      page.drawText('Other Expenses (Line 27a)', {
        x: margin,
        y: yPosition,
        size: 14,
        font: boldFont,
        color: rgb(0, 0, 0)
      });
      yPosition -= 20;

      lineItems['27a'].transactions.forEach(transaction => {
        if (yPosition < margin + 100) {
          currentPage = pdfDoc.addPage([612, 792]);
          yPosition = currentPage.getHeight() - margin;
        }

        currentPage.drawText(`• ${transaction.merchant_name}: $${Math.abs(transaction.amount).toFixed(2)}`, {
          x: margin + 20,
          y: yPosition,
          size: 10,
          font: font,
          color: rgb(0, 0, 0)
        });
        yPosition -= 15;
      });
    }

    // Footer
    yPosition = margin + 50;
    page.drawText('Note: This is a summary document. Always consult with a tax professional for proper filing.', {
      x: margin,
      y: yPosition,
      size: 10,
      font: font,
      color: rgb(0.5, 0.5, 0.5)
    });

    // Generate PDF bytes
    const pdfBytes = await pdfDoc.save();

    // Return PDF as response
    return new NextResponse(pdfBytes as any, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="schedule-c-${year}.pdf"`
      }
    });

  } catch (error) {
    console.error('PDF generation error:', error);
    return NextResponse.json(
      { error: 'Failed to generate PDF' },
      { status: 500 }
    );
  }
}
