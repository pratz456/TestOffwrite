/**
 * One time rewrite of the legacy deduction choice spelling on user_profiles.
 *
 * Dry run is the default. It counts matching documents and writes nothing.
 * Apply updates only itemization_status, and only while the stored value is
 * still the legacy spelling. It does not set the document, does not touch any
 * other field, and does not change updated_at.
 *
 * This file does not connect to Firebase, load credentials, or call the network.
 * Callers in tests pass an in memory database. Running the script, including a
 * dry run against stored profiles, needs separate approval.
 *
 *   dry run : runItemizationStatusMigration({ db })
 *   apply   : runItemizationStatusMigration({ db, apply: true, confirmation })
 *
 * confirmation is apply:<sha256 of {"mode":"dry_run","matched":N,"writesPerformed":false}>.
 * Standard output is the count object only. No account identifiers are printed.
 */
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const LEGACY_ITEMIZATION_STATUS = 'itemized';
const CANONICAL_ITEMIZATION_STATUS = 'itemize';
const MAX_BATCH_SIZE = 450;

export function reviewedItemizationPlanConfirmation(matched) {
  const digest = createHash('sha256')
    .update(JSON.stringify({ mode: 'dry_run', matched, writesPerformed: false }))
    .digest('hex');
  return `apply:${digest}`;
}

function groupsOf(items, size) {
  const groups = [];
  for (let index = 0; index < items.length; index += size) groups.push(items.slice(index, index + size));
  return groups;
}

function storedStatus(snapshot) {
  if (!snapshot || snapshot.exists === false) return undefined;
  const data = typeof snapshot.data === 'function' ? snapshot.data() : snapshot.data;
  return data ? data.itemization_status : undefined;
}

/**
 * @param {{ db: { collection: Function, runTransaction: Function }, apply?: boolean, confirmation?: string, batchSize?: number, log?: (line: string) => void }} options
 */
export async function runItemizationStatusMigration({
  db,
  apply = false,
  confirmation,
  batchSize = 400,
  log = console.log,
} = {}) {
  if (!db || typeof db.collection !== 'function' || typeof db.runTransaction !== 'function') {
    throw new Error('A database handle is required');
  }
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > MAX_BATCH_SIZE) {
    throw new Error(`Batch size must be an integer from 1 to ${MAX_BATCH_SIZE}`);
  }

  const matchedSnap = await db.collection('user_profiles')
    .where('itemization_status', '==', LEGACY_ITEMIZATION_STATUS)
    .select('itemization_status')
    .get();
  const matched = matchedSnap.size ?? matchedSnap.docs.length;

  if (!apply) {
    const result = { mode: 'dry_run', matched, writesPerformed: false };
    log(JSON.stringify(result));
    return result;
  }

  if (confirmation !== reviewedItemizationPlanConfirmation(matched)) {
    throw new Error('Use --apply --confirm apply:<sha256 of the reviewed dry run counts>');
  }

  let updated = 0;
  let skippedChanged = 0;
  let failed = 0;
  const refs = matchedSnap.docs.map(doc => doc.ref);
  for (const group of groupsOf(refs, batchSize)) {
    try {
      const counts = await db.runTransaction(async transaction => {
        let batchUpdated = 0;
        let batchSkipped = 0;
        for (const ref of group) {
          const current = await transaction.get(ref);
          if (storedStatus(current) !== LEGACY_ITEMIZATION_STATUS) {
            batchSkipped += 1;
            continue;
          }
          transaction.update(ref, { itemization_status: CANONICAL_ITEMIZATION_STATUS });
          batchUpdated += 1;
        }
        return { batchUpdated, batchSkipped };
      });
      updated += counts.batchUpdated;
      skippedChanged += counts.batchSkipped;
    } catch {
      failed += group.length;
    }
  }

  const result = { mode: 'apply', matched, updated, skippedChanged, failed };
  log(JSON.stringify(result));
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  console.error('This migration does not connect to Firebase. Running it, including a dry run, needs separate approval.');
  process.exitCode = 1;
}
