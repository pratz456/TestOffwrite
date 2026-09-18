"use client";

import React from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FileText, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import writeOffLogo from '@/public/writeofflogo.png';
import Image from 'next/image';
import { CONSENT_TERMS_VERSION } from '@/lib/onboarding/consents';

/**
 * Terms of Service. Written to describe what the product does today (records organization,
 * planning estimates, AI suggestions the customer confirms, exports for a preparer) and what
 * it does not do (prepare or file returns, give tax advice). Version tracks the sign-up
 * acknowledgments; a wording change must bump CONSENT_TERMS_VERSION so existing accounts
 * re-acknowledge.
 */
export default function TermsPageClient() {
  return (
    <div className="min-h-screen bg-background">
      <div className="bg-card border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Image src={writeOffLogo} alt="WriteOff" className="w-8 h-auto" />
              <h1 className="text-2xl font-bold text-foreground">Terms of Service</h1>
            </div>
            <Link href="/">
              <Button variant="outline" size="sm">
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back to Home
              </Button>
            </Link>
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-6 md:px-8 py-12 md:py-16">
        <Card className="rounded-2xl shadow-tight border border-border dark:bg-card">
          <CardHeader className="p-8 md:p-10 pb-2">
            <CardTitle className="flex items-center gap-2 text-2xl md:text-3xl font-bold tracking-tight mb-1">
              <FileText className="w-5 h-5 text-primary" />
              Terms of Service
            </CardTitle>
            <CardDescription className="text-sm text-muted-foreground mb-8 font-tabular-nums">
              Effective date: September 18, 2026 (version {CONSENT_TERMS_VERSION})
            </CardDescription>
          </CardHeader>
          <CardContent className="p-8 md:p-10 pt-4 space-y-6 [&>div:not(:first-child)]:mt-10 [&>div:not(:first-child)]:border-t [&>div:not(:first-child)]:border-border [&>div:not(:first-child)]:pt-8 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:mb-3 [&_p]:text-sm [&_p]:leading-relaxed [&_li]:text-sm [&_li]:leading-relaxed [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1">
            <div>
              <p className="mb-4">
                These Terms of Service (&ldquo;Terms&rdquo;) are an agreement between you and WriteOff (&ldquo;WriteOff&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;) covering your use of the WriteOff website, web application and related services (the &ldquo;Service&rdquo;). By creating an account or using the Service you agree to these Terms and to our <Link href="/privacy" className="underline">Privacy Policy</Link>. If you do not agree, do not use the Service.
              </p>
            </div>

            <div>
              <h3>1. What WriteOff is, and is not</h3>
              <p className="mb-3">
                WriteOff is software that helps self-employed people organize business income and expense records, review possible tax deductions, and produce planning estimates and records exports for their own use or for a tax preparer.
              </p>
              <ul>
                <li><strong>WriteOff does not prepare, sign, or file tax returns</strong> with the IRS or any state, and does not provide e-filing.</li>
                <li><strong>WriteOff does not provide tax, legal, accounting or financial advice.</strong> Explanations, categories, estimates and reminders are informational planning tools based on the records you save and the federal rules the software currently models. They are not a determination of your tax liability or of what you may deduct.</li>
                <li>Federal estimates cover the tax years and situations described in the product; unsupported situations are shown as needing review rather than estimated. State figures, where shown, are informational planning estimates only.</li>
                <li>Suggestions produced with artificial intelligence are proposals. <strong>Nothing is treated as a deduction or classification until you confirm it.</strong> You are responsible for the accuracy of the purposes, amounts and facts you save.</li>
                <li>Only you, or a tax professional you engage, decide what to report on a return. Review WriteOff&apos;s records and estimates with a qualified professional before relying on them.</li>
              </ul>
            </div>

            <div>
              <h3>2. Eligibility and your account</h3>
              <ul>
                <li>You must be at least 18 years old and able to form a binding contract, and you may use the Service only for your own business or one you are authorized to act for.</li>
                <li>You are responsible for keeping your sign-in credentials secure and for all activity under your account. Tell us promptly at <a href="mailto:writeoffapp@gmail.com" className="underline">writeoffapp@gmail.com</a> if you believe your account has been accessed without permission.</li>
                <li>You must provide accurate information and keep it current. We may suspend or close accounts used for fraud, abuse, unlawful activity, or in violation of these Terms.</li>
              </ul>
            </div>

            <div>
              <h3>3. Bank connections, documents and third-party services</h3>
              <ul>
                <li>You may connect financial accounts through Plaid. By doing so you authorize WriteOff to receive account and transaction data from your financial institution through Plaid, under <a href="https://plaid.com/legal/" target="_blank" rel="noopener noreferrer" className="underline">Plaid&apos;s End User Privacy Policy</a>. Connections are read-only; WriteOff cannot move money.</li>
                <li>Bank connections depend on your financial institution and on Plaid. They can be interrupted or require re-authorization, and historical data availability varies by institution. Your saved records remain in your account when a connection is unavailable.</li>
                <li>Documents you upload are stored privately for your account. Tax forms (W-2s, 1099s, platform summaries) are read by software running on our servers; identifying numbers are removed before the text is sent to our AI provider, and the form image itself is sent only if you give the specific signed consent described in the product. Receipts and bank or card statements you choose to import for extraction are sent to our AI provider as images, as described in the <Link href="/privacy" className="underline">Privacy Policy</Link>.</li>
                <li>Payments are processed by Stripe under Stripe&apos;s terms. WriteOff does not store your full card number.</li>
              </ul>
            </div>

            <div>
              <h3>4. Plans, trials and billing</h3>
              <ul>
                <li>New accounts may receive a free trial (currently 30 days) with access to the full feature set. A trial can be used once per account and does not renew.</li>
                <li>Paid plans are billed in advance by Stripe on a monthly or yearly basis at the price shown at checkout, plus applicable taxes. Prices for new subscriptions may change; we will notify you before a change affects your renewal.</li>
                <li>You may cancel at any time from Settings. Cancellation takes effect at the end of the current billing period; you keep paid features until then. Fees already paid are not refunded except where required by law or stated in writing by us.</li>
                <li>If a payment fails, paid features may be limited until payment succeeds. Your saved records remain accessible to you.</li>
                <li>Feature availability by plan is described in the product. We may change or retire features with reasonable notice; we will not remove your ability to export your saved records.</li>
              </ul>
            </div>

            <div>
              <h3>5. Your records and our license to process them</h3>
              <ul>
                <li>You own the records you save. You grant WriteOff a limited license to store, process, analyze and display them solely to provide and improve the Service for you, as described in the Privacy Policy.</li>
                <li>Your corrections and confirmations personalize suggestions within your own account. We do not use your records to train AI models.</li>
                <li>You can export your records at any time and delete your account from Settings. Deletion removes your records from the live database; backup copies expire on the schedule described in the Privacy Policy.</li>
                <li>Keep your own copies of receipts and records supporting any deduction; the IRS generally expects records to be kept for at least three years after a return is filed, and longer in some cases.</li>
              </ul>
            </div>

            <div>
              <h3>6. Acceptable use</h3>
              <p className="mb-3">You agree not to:</p>
              <ul>
                <li>use the Service to record fictitious transactions, fabricate business purposes, or otherwise prepare false records;</li>
                <li>access another person&apos;s account or records, or connect financial accounts you are not authorized to use;</li>
                <li>interfere with the Service, probe or circumvent its security, or use automated means to extract data beyond the exports we provide;</li>
                <li>resell or provide the Service to third parties, or use it to provide tax preparation services to others without our written agreement.</li>
              </ul>
            </div>

            <div>
              <h3>7. Disclaimers</h3>
              <p className="mb-3">
                The Service is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo;. To the fullest extent permitted by law, WriteOff disclaims all warranties, express or implied, including fitness for a particular purpose and non-infringement. We do not warrant that estimates are accurate for your situation, that every deduction will be identified, that any deduction will be allowed by a tax authority, or that the Service will be uninterrupted or error-free. Tax law changes; figures for a tax year are provisional until the IRS publishes the final amounts, and the product labels unpublished years accordingly.
              </p>
            </div>

            <div>
              <h3>8. Limitation of liability</h3>
              <p className="mb-3">
                To the fullest extent permitted by law, WriteOff and its officers, employees and suppliers will not be liable for any indirect, incidental, special, consequential or punitive damages, or for any taxes, penalties, interest, or lost refunds arising from your use of the Service or reliance on its estimates and suggestions. Our total liability for any claim relating to the Service is limited to the amount you paid us for the Service in the twelve months before the claim. Some jurisdictions do not allow certain limitations; in those places the limitations apply to the extent permitted.
              </p>
            </div>

            <div>
              <h3>9. Changes to the Service and to these Terms</h3>
              <p className="mb-3">
                We may modify the Service and these Terms. When we change these Terms in a way that affects your rights or obligations, we will post the new version with a new effective date and ask you to acknowledge it the next time you sign in. Continued use after acknowledgment means you accept the updated Terms.
              </p>
            </div>

            <div>
              <h3>10. Termination</h3>
              <p className="mb-3">
                You may stop using the Service and delete your account at any time. We may suspend or terminate access for violation of these Terms or for legal or security reasons; where practical we will give notice and an opportunity to export your records. Sections 1, 5, 7, 8 and 11 survive termination.
              </p>
            </div>

            <div>
              <h3>11. Governing law and disputes</h3>
              <p className="mb-3">
                These Terms are governed by the laws of the State of California, without regard to its conflict-of-law rules, and by applicable U.S. federal law. Before filing a claim, you agree to contact us at <a href="mailto:writeoffapp@gmail.com" className="underline">writeoffapp@gmail.com</a> and attempt in good faith to resolve the dispute for at least 30 days. Claims that cannot be resolved may be brought in the state or federal courts located in California, and you consent to their jurisdiction.
              </p>
            </div>

            <div>
              <h3>12. Contact</h3>
              <p className="mb-3">
                Questions about these Terms: <a href="mailto:writeoffapp@gmail.com" className="underline">writeoffapp@gmail.com</a>.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
