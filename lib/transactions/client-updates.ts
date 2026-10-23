import { z } from 'zod';

const text = z.string().max(5000).nullable().transform(value => value ?? '').optional();
export const transactionIdInput = z.string().min(1).max(256).regex(/^[^/\\\x00-\x1f\x7f]+$/);

/** Match the user-editable Firestore fields; owner, bank amounts and AI output stay server-owned. */
export const transactionUpdatesInput = z.object({
  notes: text, user_classification_reason: text, receipt_url: text, receipt_filename: text,
  is_deductible: z.boolean().nullable().optional(), expense_type: z.enum(['business', 'personal']).nullable().optional(),
  deduction_score: z.number().finite().min(0).max(1).optional(), deductible_reason: text,
  business_purpose: text, attendees: z.array(z.string().max(300)).max(100).optional(), travel_destination: text,
  client_project: text, documentation_status: z.enum(['complete', 'partial', 'missing']).optional(), meeting_notes: text,
  equipment_details: z.object({ make: text, model: text, year: z.number().int().min(1900).max(2200).optional(),
    business_use_percentage: z.number().finite().min(0).max(100).optional(),
    depreciation_method: z.enum(['straight_line', 'declining_balance', 'section_179']).optional() }).strict().optional(),
  mileage_details: z.object({ start_location: text, end_location: text, miles: z.number().finite().nonnegative().optional(), business_purpose: text }).strict().optional(),
}).strict().refine(value => Object.keys(value).length > 0, 'Provide at least one editable field');

export const transactionCreateInput = z.object({
  trans_id: transactionIdInput, account_id: transactionIdInput,
  merchant_name: z.string().trim().min(1).max(500),
  amount: z.number().finite(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value),
  category: z.string().max(200).optional(),
  notes: text, description: text, business_purpose: text,
  type: z.enum(['income', 'expense']).optional(), is_deductible: z.boolean().nullable().optional(),
}).strict();
