import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const worker = vi.hoisted(() => ({ recognize: vi.fn(), terminate: vi.fn() }));
const createWorker = vi.hoisted(() => vi.fn(async () => worker));
vi.mock('tesseract.js', () => ({ default: { createWorker } }));

import { recognizeDocumentText } from '@/lib/ocr/document-text';
import { receiptProcessor } from '@/lib/ocr/receipt-processor';

const localWorkerOptions = {
  langPath: path.join(process.cwd(), 'tessdata'),
  gzip: false,
  cachePath: os.tmpdir(),
  cacheMethod: 'none',
};

afterEach(async () => {
  await receiptProcessor.terminate();
  vi.clearAllMocks();
});

describe('server OCR workers use local tessdata', () => {
  it('passes a local langPath and gzip false for receipt OCR', async () => {
    worker.recognize.mockResolvedValue({ data: { text: 'SYNTHETIC OFFICE STORE\nTOTAL $1.00', confidence: 90 } });
    await receiptProcessor.processReceipt(Buffer.from('synthetic input'));
    expect(createWorker).toHaveBeenCalledWith('eng', 1, expect.objectContaining(localWorkerOptions));
  });

  it('passes a local langPath and gzip false for tax document OCR', async () => {
    worker.recognize.mockResolvedValue({ data: { text: 'Form W-2 wages 1000.00', confidence: 90 } });
    await recognizeDocumentText(Buffer.from('synthetic input'), 'image/png');
    expect(createWorker).toHaveBeenCalledWith('eng', 1, expect.objectContaining(localWorkerOptions));
  });
});
