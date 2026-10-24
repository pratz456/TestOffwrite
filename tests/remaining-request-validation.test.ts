import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { OWNER_ID_TOKEN, SERVICE_SECRET, SITE_URL, installApiRouteMocks } from './fixtures/api-route-harness';
import { recordedRateLimitCount } from './fixtures/rate-limit-store';
import type { FakeFirestore } from './fixtures/fake-firestore';

const harness = installApiRouteMocks();
const writes: string[] = [];

function partialBody(prefix: string): ReadableStream<Uint8Array> {
  const encoded = new TextEncoder().encode(prefix);
  let sent = false;
  return new ReadableStream({
    pull(controller) {
      if (!sent) {
        sent = true;
        controller.enqueue(encoded);
        return;
      }
      controller.error(new Error('stopped'));
    },
  });
}

function request(method: string, path: string, body: BodyInit, headers: Record<string, string> = {}) {
  return new NextRequest(`${SITE_URL}${path}`, {
    method,
    headers: { authorization: `Bearer ${OWNER_ID_TOKEN}`, 'content-type': 'application/json', ...headers },
    body,
    duplex: 'half',
  } as RequestInit);
}

function watchFirestore(db: FakeFirestore) {
  const wrapRef = (document: { path: string; set: (...args: unknown[]) => Promise<unknown>; update: (...args: unknown[]) => Promise<unknown>; create: (...args: unknown[]) => Promise<unknown>; delete: (...args: unknown[]) => Promise<unknown>; collection: (name: string) => unknown }) => {
    for (const method of ['set', 'update', 'create', 'delete'] as const) {
      const original = document[method].bind(document);
      vi.spyOn(document, method).mockImplementation(async (...args: unknown[]) => {
        writes.push(`${method} ${document.path}`);
        return original(...args);
      });
    }
    const nested = document.collection.bind(document);
    vi.spyOn(document, 'collection').mockImplementation((name: string) => wrapQuery(nested(name)));
    return document;
  };
  const wrapQuery = (query: { path: string; add: (...args: unknown[]) => Promise<unknown>; doc: (id?: string) => ReturnType<typeof wrapRef> }) => {
    const add = query.add.bind(query);
    vi.spyOn(query, 'add').mockImplementation(async (...args: unknown[]) => {
      writes.push(`add ${query.path}`);
      return add(...args);
    });
    const doc = query.doc.bind(query);
    vi.spyOn(query, 'doc').mockImplementation((id?: string) => wrapRef(doc(id)));
    return query;
  };

  const originalDoc = db.doc.bind(db);
  const originalCollection = db.collection.bind(db);
  const originalBatch = db.batch.bind(db);
  const originalTransaction = db.runTransaction.bind(db);
  const originalDelete = db.recursiveDelete.bind(db);
  vi.spyOn(db, 'doc').mockImplementation((path: string) => wrapRef(originalDoc(path)));
  vi.spyOn(db, 'collection').mockImplementation((name: string) => wrapQuery(originalCollection(name)));
  vi.spyOn(db, 'batch').mockImplementation(() => {
    const writer = originalBatch();
    const commit = writer.commit.bind(writer);
    writer.commit = async () => {
      writes.push('batch');
      return commit();
    };
    return writer;
  });
  vi.spyOn(db, 'runTransaction').mockImplementation(async (work) => originalTransaction(async (tx) => {
    for (const method of ['set', 'update', 'create', 'delete'] as const) {
      const original = tx[method].bind(tx);
      tx[method] = (...args: unknown[]) => {
        writes.push(`transaction ${method}`);
        return original(...args);
      };
    }
    return work(tx);
  }));
  vi.spyOn(db, 'recursiveDelete').mockImplementation(async (target) => {
    writes.push('recursiveDelete');
    return originalDelete(target);
  });
}

async function expectNoFollowUpWork(limitSpy: { mock: { calls: unknown[] } }) {
  expect(writes).toEqual([]);
  expect(limitSpy.mock.calls).toEqual([]);
  expect(harness.plaidCalls).toEqual([]);
  expect(harness.storageCalls).toEqual([]);
  expect(harness.fetch).not.toHaveBeenCalled();
  const policies = (await import('@/lib/security/rate-limit')).RATE_LIMITS;
  expect(recordedRateLimitCount(policies.bulkConfirm.scope)).toBe(0);
  expect(recordedRateLimitCount(policies.reportExport.scope)).toBe(0);
  expect(recordedRateLimitCount(policies.analysisCatchUp.scope)).toBe(0);
  const jobs = await import('@/lib/ai/analysis-jobs');
  const refresh = await import('@/lib/ai/profile-analysis-refresh');
  expect(jobs.enqueueBankTransactionAnalysis).not.toHaveBeenCalled();
  expect(jobs.enqueueAccountAnalysis).not.toHaveBeenCalled();
  expect(jobs.processAnalysisTask).not.toHaveBeenCalled();
  expect(refresh.enqueueProfileAnalysisRefresh).not.toHaveBeenCalled();
  expect(refresh.processProfileAnalysisRefresh).not.toHaveBeenCalled();
}

async function expectInvalid(response: Response, limitSpy: { mock: { calls: unknown[] } }) {
  expect(response.status).toBe(400);
  await expect(response.json()).resolves.toEqual({ error: 'Invalid JSON body' });
  await expectNoFollowUpWork(limitSpy);
}

const idParams = { params: Promise.resolve({ id: 'tx1' }) };

describe('consistent request validation for remaining routes', () => {
  let limitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    await harness.reset();
    writes.length = 0;
    harness.seedOwnerProfile();
    watchFirestore(harness.db);
    const rateLimit = await import('@/lib/security/rate-limit');
    limitSpy = vi.spyOn(rateLimit, 'enforceRateLimit');
    const jobs = await import('@/lib/ai/analysis-jobs');
    const refresh = await import('@/lib/ai/profile-analysis-refresh');
    vi.spyOn(jobs, 'enqueueBankTransactionAnalysis');
    vi.spyOn(jobs, 'enqueueAccountAnalysis');
    vi.spyOn(jobs, 'processAnalysisTask');
    vi.spyOn(refresh, 'enqueueProfileAnalysisRefresh');
    vi.spyOn(refresh, 'processProfileAnalysisRefresh');
    for (const level of ['log', 'warn', 'error'] as const) vi.spyOn(console, level).mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects a partial bulk confirm request', async () => {
    const { POST } = await import('../app/api/transactions/bulk-confirm/route');
    const response = await POST(request('POST', '/api/transactions/bulk-confirm', partialBody('{"merchantKey":"acme","decision":')));
    await expectInvalid(response, limitSpy);
  });

  it('rejects a partial token exchange request', async () => {
    const { POST } = await import('../app/api/plaid/exchange-token/route');
    const response = await POST(request('POST', '/api/plaid/exchange-token', partialBody('{"publicToken":')));
    await expectInvalid(response, limitSpy);
    expect(harness.auth.verifyIdToken).not.toHaveBeenCalled();
  });

  it('rejects a partial report export request', async () => {
    const { POST } = await import('../app/api/reports/export/route');
    const response = await POST(request('POST', '/api/reports/export', partialBody('{"type":"form8829","year":')));
    await expectInvalid(response, limitSpy);
  });

  it('rejects a partial preparer summary request', async () => {
    const { POST } = await import('../app/api/reports/generate-pdf/route');
    const response = await POST(request('POST', '/api/reports/generate-pdf', partialBody('{"year":')));
    await expectInvalid(response, limitSpy);
  });

  it('rejects a partial receipt update request', async () => {
    const { PUT } = await import('../app/api/receipts/process/route');
    const response = await PUT(request('PUT', '/api/receipts/process', partialBody('{"transactionId":"tx1","updates":')));
    await expectInvalid(response, limitSpy);
  });

  it('rejects a partial transaction update request', async () => {
    const { PUT } = await import('../app/api/transactions/[id]/route');
    const response = await PUT(request('PUT', '/api/transactions/tx1', partialBody('{"notes":')), idParams);
    await expectInvalid(response, limitSpy);
  });

  it('rejects a partial transaction review request', async () => {
    const { POST } = await import('../app/api/transactions/[id]/review/route');
    const response = await POST(request('POST', '/api/transactions/tx1/review', partialBody('{"action":')), idParams);
    await expectInvalid(response, limitSpy);
  });

  it('rejects a partial reconciliation create request', async () => {
    const { POST } = await import('../app/api/income/reconciliation/route');
    const response = await POST(request('POST', '/api/income/reconciliation', partialBody('{"taxYear":')));
    await expectInvalid(response, limitSpy);
  });

  it('rejects a partial reconciliation update request', async () => {
    const { PATCH } = await import('../app/api/income/reconciliation/route');
    const response = await PATCH(request('PATCH', '/api/income/reconciliation', partialBody('{"id":"decision","taxYear":')));
    await expectInvalid(response, limitSpy);
  });

  it('rejects a partial transaction create request', async () => {
    const { POST } = await import('../app/api/database/transactions/route');
    const response = await POST(request('POST', '/api/database/transactions', partialBody('{"merchant_name":')));
    await expectInvalid(response, limitSpy);
  });

  it('rejects a partial stored transaction update request', async () => {
    const { PUT } = await import('../app/api/database/transactions/route');
    const response = await PUT(request('PUT', '/api/database/transactions', partialBody('{"transactionId":"tx1","updates":')));
    await expectInvalid(response, limitSpy);
  });

  it('rejects a partial analysis worker request', async () => {
    const { POST } = await import('../app/api/internal/analysis-worker/route');
    const response = await POST(request('POST', '/api/internal/analysis-worker', partialBody('{"action":"enqueue","userId":'), {
      'x-analysis-worker-secret': SERVICE_SECRET,
    }));
    await expectInvalid(response, limitSpy);
  });

  it('rejects a partial account analysis request', async () => {
    const { POST } = await import('../app/api/plaid/auto-analyze/route');
    const response = await POST(request('POST', '/api/plaid/auto-analyze', partialBody('{"accountId":')));
    await expectInvalid(response, limitSpy);
  });
});
