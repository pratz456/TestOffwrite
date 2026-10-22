/** Reviewed FAQ copy shared by the landing FAQ accordion and the /help FAQPage JSON-LD (claims policy: docs/PRODUCT_ROADMAP_2026-09-17.md §4). */
export interface FAQItem {
  question: string;
  answer: string;
  category: string;
}

export const faqData: FAQItem[] = [
  {
    question: "What is WriteOff?",
    answer: "WriteOff helps freelancers and small business owners organize expenses, review receipts, and export records for a tax preparer. Federal planning estimates are available for supported situations; the app does not prepare or file a complete tax return.",
    category: "general"
  },
  {
    question: "How does WriteOff work?",
    answer: "Set up your work profile, enter an expense or upload a receipt, then review the amount, date, category and business purpose. You can download your records archive on any plan or use report exports with a trial or Premium plan. No bank connection is required to get started.",
    category: "general"
  },
  {
    question: "Who can access my receipts and records?",
    answer: "Your saved records and receipt attachments require your authenticated account. Receipt links are private account links, not sharing links for an accountant. Downloaded exports contain your information, so choose carefully where you store or share them. See the Privacy Policy for data-handling details.",
    category: "security"
  },
  {
    question: "Can I connect a bank account?",
    answer: "Where bank connections are enabled, you can link accounts through Plaid and WriteOff imports posted transactions for your review. Bank tokens are encrypted and never shown in the app. You can always enter income and expenses manually and upload receipts instead.",
    category: "banking"
  },
  {
    question: "Is AI categorization available?",
    answer: "Where enabled, AI suggests a category, a possible tax treatment and the facts still needed for each imported transaction. Nothing counts toward your totals until you confirm it, and unresolved questions stay marked for review. Receipt text extraction can make mistakes, so check the merchant, date and amount before saving; neither feature determines on its own whether an expense is deductible.",
    category: "ai"
  },
  {
    question: "What types of expenses can I track?",
    answer: "You can record expenses such as supplies, travel, meals, equipment and software. Recording a purchase or selecting a category does not establish that it is deductible. Keep its business purpose and supporting receipt for review.",
    category: "expenses"
  },
  {
    question: "Can I upload receipts?",
    answer: "Yes. Upload a receipt, review the extracted merchant, date and amount, and correct any mistakes before saving. Receipt files stay linked privately to your account and are not bundled in the records archive.",
    category: "features"
  },
  {
    question: "What tax reports does WriteOff generate?",
    answer: "Trial and Premium plans include supported Schedule C summaries, transaction CSVs, cash-flow reports and planning worksheets. Missing or unsupported tax facts can require review before an estimate or worksheet is available. These exports are records for review, not official filed returns; in-app filing is unavailable.",
    category: "reports"
  },
  {
    question: "Is WriteOff suitable for my business type?",
    answer: "Expense and receipt organization can help freelancers and small business owners. Federal estimates cover only supported individual tax situations, including certain simple Schedule C cases. Complex businesses, credits and other special facts need separate professional review. The app does not prepare state or business-entity returns.",
    category: "general"
  },
  {
    question: "How much does WriteOff cost?",
    answer: "The Free plan keeps basic records and the records archive accessible. The 30-day trial and Premium plans unlock reports and exports. Listed Premium pricing is $14.99 monthly or $149.99 yearly; existing Basic subscribers keep their $7.99 monthly price and extended history. In-app tax filing is not offered on any plan.",
    category: "pricing"
  }
];
