import Tesseract from 'tesseract.js';

/**
 * Local (in-process) OCR for uploaded tax documents, the first step of the
 * redact-first import pipeline: the text it returns has identifiers removed by
 * lib/security/identifier-redaction before anything reaches a model. It uses
 * the same native Tesseract worker call as the receipts flow
 * (lib/ocr/receipt-processor.ts); next.config.ts traces the worker files for
 * the import route. Recognized text is returned to the caller only and never
 * logged.
 */
export interface DocumentOcr {
  text: string;
  /** Mean word confidence, 0..1. */
  confidence: number;
}

/** Below this, OCR text is not trusted for extraction and the consented image path is the only option. */
export const DOCUMENT_OCR_MIN_CONFIDENCE = 0.5;
/** A form that produced fewer characters than this was not really read. */
export const DOCUMENT_OCR_MIN_TEXT_CHARS = 40;
const OCR_TIMEOUT_MS = 45_000;
const OCR_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/bmp', 'image/gif']);

let workerPromise: Promise<Tesseract.Worker> | null = null;

function ocrWorker(): Promise<Tesseract.Worker> {
  workerPromise ??= Tesseract.createWorker('eng', 1, { errorHandler: () => undefined, logger: () => undefined });
  return workerPromise;
}

/** PDFs and other non-image uploads have no local OCR path. */
export function documentOcrSupported(mimeType: string): boolean {
  return OCR_IMAGE_TYPES.has(mimeType.toLowerCase());
}

/** Recognizes an image; null when the type is unsupported or recognition fails or hangs. */
export async function recognizeDocumentText(bytes: Buffer, mimeType: string): Promise<DocumentOcr | null> {
  if (!documentOcrSupported(mimeType)) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const worker = await ocrWorker();
    const result = await Promise.race([
      worker.recognize(bytes),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('OCR timed out')), OCR_TIMEOUT_MS); }),
    ]);
    const confidence = Number(result.data.confidence);
    return { text: result.data.text ?? '', confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence / 100)) : 0 };
  } catch {
    // A failed or hung worker is discarded so the next request starts clean.
    const failed = workerPromise;
    workerPromise = null;
    void failed?.then(worker => worker.terminate()).catch(() => undefined);
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Whether OCR output is good enough to extract from without disclosing the image. */
export function documentOcrUsable(ocr: DocumentOcr | null): ocr is DocumentOcr {
  return ocr !== null && ocr.confidence >= DOCUMENT_OCR_MIN_CONFIDENCE
    && ocr.text.replace(/\s+/g, '').length >= DOCUMENT_OCR_MIN_TEXT_CHARS && /\d/.test(ocr.text);
}
