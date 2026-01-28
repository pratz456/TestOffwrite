export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromReqOrThrow } from '@/app/api/_lib/auth';
import { getUserProfileServer } from '@/lib/firebase/profiles-server';
import { getTransactionsServer } from '@/lib/firebase/transactions-server';
import { generateForm8829PDF } from '@/lib/reports/form8829';
import { generateForm4562PDF } from '@/lib/reports/form4562';
import { generateScheduleSEPDF } from '@/lib/reports/scheduleSE';
import { getHomeOfficeSettings, getAssetsSettings, getTaxSummarySettings } from '@/lib/firebase/settings-server';

type FormType = 'form8829' | 'form4562' | 'scheduleSE';

export async function POST(request: NextRequest) {
  try {
    console.log('🔄 [Reports Export API] Starting request...');

    // Get the authenticated user
    const { uid } = await getUserFromReqOrThrow(request);

    console.log('✅ [Reports Export API] User authenticated:', uid);

    const { type } = await request.json();

    if (!type || !['form8829', 'form4562', 'scheduleSE'].includes(type)) {
      return NextResponse.json(
        { error: 'Invalid form type. Must be form8829, form4562, or scheduleSE' },
        { status: 400 }
      );
    }

    console.log(`📋 [Reports Export API] Generating ${type} for user ${uid}`);

    // Fetch user profile
    const { data: userProfile, error: profileError } = await getUserProfileServer(uid);
    if (profileError || !userProfile) {
      console.error('❌ [Reports Export API] Failed to fetch user profile:', profileError);
      return NextResponse.json(
        { error: 'Failed to fetch user profile' },
        { status: 500 }
      );
    }

    // Fetch transactions for calculations
    const { data: transactions, error: transactionsError } = await getTransactionsServer(uid);
    if (transactionsError) {
      console.error('❌ [Reports Export API] Failed to fetch transactions:', transactionsError);
      return NextResponse.json(
        { error: 'Failed to fetch transactions' },
        { status: 500 }
      );
    }

    let pdfBytes: Uint8Array;
    let filename: string;

    const currentYear = new Date().getFullYear();
    const today = new Date().toISOString().split('T')[0];

    switch (type as FormType) {
      case 'form8829':
        // Fetch home office settings
        const { data: homeOfficeSettings, error: homeOfficeError } = await getHomeOfficeSettings(uid);
        if (homeOfficeError || !homeOfficeSettings) {
          return NextResponse.json(
            { error: 'Home office settings not found. Please complete your home office setup in Settings.' },
            { status: 400 }
          );
        }

        // Validate required fields
        if (!homeOfficeSettings.totalHomeSqFt || !homeOfficeSettings.officeSqFt) {
          return NextResponse.json(
            { error: 'Missing home office square footage. Please complete your home office setup in Settings.' },
            { status: 400 }
          );
        }

        pdfBytes = await generateForm8829PDF({
          userProfile,
          homeOfficeSettings,
          transactions: transactions || [],
          taxYear: currentYear
        });
        filename = `form8829_${today}.pdf`;
        break;

      case 'form4562':
        // Fetch assets settings
        const { data: assetsSettings, error: assetsError } = await getAssetsSettings(uid);
        if (assetsError || !assetsSettings || assetsSettings.length === 0) {
          return NextResponse.json(
            { error: 'No assets found. Please add your business assets in Settings.' },
            { status: 400 }
          );
        }

        pdfBytes = await generateForm4562PDF({
          userProfile,
          assetsSettings,
          transactions: transactions || [],
          taxYear: currentYear
        });
        filename = `form4562_${today}.pdf`;
        break;

      case 'scheduleSE':
        // Fetch tax summary settings
        const { data: taxSummarySettings, error: taxSummaryError } = await getTaxSummarySettings(uid);
        if (taxSummaryError || !taxSummarySettings) {
          return NextResponse.json(
            { error: 'Tax summary not found. Please ensure your Schedule C data is complete.' },
            { status: 400 }
          );
        }

        pdfBytes = await generateScheduleSEPDF({
          userProfile,
          taxSummarySettings,
          transactions: transactions || [],
          taxYear: currentYear
        });
        filename = `scheduleSE_${today}.pdf`;
        break;

      default:
        return NextResponse.json(
          { error: 'Invalid form type' },
          { status: 400 }
        );
    }

    console.log(`✅ [Reports Export API] Successfully generated ${type} PDF`);

    // Return PDF as response
    return new NextResponse(pdfBytes as any, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      }
    });

  } catch (error) {
    console.error('❌ [Reports Export API] Unexpected error:', error);
    return NextResponse.json(
      {
        error: 'Failed to generate report',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
