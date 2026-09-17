#!/usr/bin/env node
/**
 * Read-only audit of taxpayer identifiers stored in `tax_organizers`.
 *
 * Counts organizer documents whose identifier answers are still plaintext (not
 * AES-256-GCM ciphertext) or whose dependent free text still contains
 * identifier-shaped digits. It never prints document ids or values and never
 * writes: the application re-encrypts legacy values when the owner next reads
 * or saves the organizer (write-on-read migration in lib/tax-organizer).
 *
 *   node scripts/organizer-identifier-audit.mjs --report --project <firebase-project-id> [--allow-emulator]
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** Same identifier answers as lib/tax-organizer/identifiers.ts (ORGANIZER_IDENTIFIER_FIELDS + dependent*SSN/ITIN). */
export const IDENTIFIER_FIELDS = ['taxpayerSSN', 'spouseSSN', 'bankAccount', 'bankRouting', 'ipPin', 'ein'];
const DEPENDENT_IDENTIFIER_FIELD = /^dependent\d*(SSN|ITIN)$/;
const REDACTED_TEXT_FIELDS = ['dependentDetails'];
// Mirrors lib/security/identifier-redaction.ts: SSN/ITIN 3-2-4, EIN 2-7, bare nine-digit runs; amounts excluded.
const IDENTIFIER_SHAPE = /(?<!\d)\d{3}[-\u2010-\u2015. ]\d{2}[-\u2010-\u2015. ]\d{4}(?!\d)|(?<!\d)\d{2}[-\u2010-\u2015. ]\d{7}(?!\d)|(?<![\d,.$])\d{9}(?!\d|[.,]\d)/u;

/** Same format check as isEncrypted() in lib/security/utils.ts. */
export function looksEncrypted(value) {
  const parts = String(value).split(':');
  return parts.length === 3 && parts.every(part => /^[A-Za-z0-9+/=]+$/.test(part));
}

export function isIdentifierField(field) {
  return IDENTIFIER_FIELDS.includes(field) || DEPENDENT_IDENTIFIER_FIELD.test(field);
}

/** Per-document classification; returns field names only, never values. */
export function classifyOrganizer(data) {
  const plaintextFields = [];
  const redactableTextFields = [];
  for (const [field, value] of Object.entries(data || {})) {
    if (typeof value !== 'string' || !value) continue;
    if (isIdentifierField(field)) {
      if (!looksEncrypted(value)) plaintextFields.push(field);
    } else if (REDACTED_TEXT_FIELDS.includes(field) && IDENTIFIER_SHAPE.test(value)) {
      redactableTextFields.push(field);
    }
  }
  return { plaintextFields, redactableTextFields };
}

export async function auditOrganizerIdentifiers(db, { pageSize = 500 } = {}) {
  const report = {
    documents: 0, documentsWithPlaintextIdentifiers: 0, documentsWithIdentifierTextToRedact: 0,
    plaintextFieldCounts: {}, encryptedFieldCounts: {},
  };
  let last = null;
  for (;;) {
    let query = db.collection('tax_organizers').orderBy('__name__').limit(pageSize);
    if (last) query = query.startAfter(last);
    const snapshot = await query.get();
    if (snapshot.empty) break;
    for (const doc of snapshot.docs) {
      const data = doc.data();
      report.documents += 1;
      const { plaintextFields, redactableTextFields } = classifyOrganizer(data);
      for (const [field, value] of Object.entries(data || {})) {
        if (isIdentifierField(field) && typeof value === 'string' && value && looksEncrypted(value)) {
          report.encryptedFieldCounts[field] = (report.encryptedFieldCounts[field] || 0) + 1;
        }
      }
      for (const field of plaintextFields) report.plaintextFieldCounts[field] = (report.plaintextFieldCounts[field] || 0) + 1;
      if (plaintextFields.length) report.documentsWithPlaintextIdentifiers += 1;
      if (redactableTextFields.length) report.documentsWithIdentifierTextToRedact += 1;
    }
    last = snapshot.docs[snapshot.docs.length - 1];
    if (snapshot.docs.length < pageSize) break;
  }
  return report;
}

async function connect({ project, allowEmulator }) {
  const [{ initializeApp, applicationDefault, deleteApp }, { getFirestore }] = await Promise.all([
    import('firebase-admin/app'),
    import('firebase-admin/firestore'),
  ]);
  const app = initializeApp({ ...(allowEmulator ? {} : { credential: applicationDefault() }), projectId: project }, `organizer-identifier-audit-${Date.now()}`);
  return { db: getFirestore(app), close: () => deleteApp(app) };
}

export async function runOrganizerIdentifierAudit({ project, report, allowEmulator = false, inheritedEnv = process.env, connectDb = connect }) {
  if (!report) throw new Error('This audit is read-only; pass --report to run it');
  if (!project) throw new Error('Use --project <firebase-project-id>');
  if (allowEmulator) {
    if (!inheritedEnv.FIRESTORE_EMULATOR_HOST || !/^demo-[a-z0-9-]+$/.test(project)) {
      throw new Error('--allow-emulator is for local tests only: it requires FIRESTORE_EMULATOR_HOST and a demo- project');
    }
  } else if (inheritedEnv.FIRESTORE_EMULATOR_HOST) {
    throw new Error('Organizer identifier audit refuses a Firestore emulator without --allow-emulator');
  }
  const connection = await connectDb({ project, allowEmulator });
  try {
    return { project, generatedAt: new Date().toISOString(), readOnly: true, ...await auditOrganizerIdentifiers(connection.db) };
  } finally {
    await connection.close?.();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const flags = { '--report': false, '--allow-emulator': false };
    const values = {};
    for (let i = 2; i < process.argv.length; i++) {
      const argument = process.argv[i];
      if (argument in flags) { flags[argument] = true; continue; }
      if (argument !== '--project' || !process.argv[i + 1]) throw new Error('Use --report --project <firebase-project-id> [--allow-emulator]');
      values[argument] = process.argv[++i];
    }
    const result = await runOrganizerIdentifierAudit({ project: values['--project'], report: flags['--report'], allowEmulator: flags['--allow-emulator'] });
    console.log(JSON.stringify(result, null, 2));
    console.log(result.documentsWithPlaintextIdentifiers || result.documentsWithIdentifierTextToRedact
      ? 'Legacy plaintext remains; it is re-encrypted/redacted when each owner next opens or saves the organizer. No records were changed.'
      : 'PASS: every stored organizer identifier is ciphertext and dependent notes carry no identifier digits. No records were changed.');
  } catch (error) {
    console.error(`FAIL: ${error instanceof Error ? error.message : 'Organizer identifier audit failed'}`);
    process.exitCode = 1;
  }
}
