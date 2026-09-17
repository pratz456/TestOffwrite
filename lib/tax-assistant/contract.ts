import { z } from 'zod';
import { SELECTABLE_TOPICS } from './knowledge';

export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export const MAX_REQUEST_BYTES = 3 * 1024 * 1024;
export const MAX_HISTORY_MESSAGES = 12;

const messageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().trim().min(1).max(6000),
}).strict();

export const assistantRequestSchema = z.object({
  message: z.string().trim().min(1).max(4000),
  taxYear: z.union([z.literal(2026), z.literal(2027)]).default(2026),
  conversationHistory: z.array(messageSchema).max(MAX_HISTORY_MESSAGES).default([]),
  imageDataUrl: z.string().max(Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 64).optional(),
}).strict();

export type AssistantRequest = z.infer<typeof assistantRequestSchema>;

/** Validate local image bytes; never let a caller make the provider fetch an arbitrary URL. */
export function isSupportedImage(dataUrl: string): boolean {
  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!match || match[2].length % 4 !== 0) return false;
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES || bytes.toString('base64') !== match[2]) return false;
  if (match[1] === 'jpeg') return bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (match[1] === 'png') return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  return bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
}

/** Bound the actual body even when Content-Length is absent or inaccurate. */
export async function readAssistantBody(request: Request): Promise<unknown> {
  if (Number(request.headers.get('content-length')) > MAX_REQUEST_BYTES) {
    throw new RangeError('Request is too large');
  }
  const reader = request.body?.getReader();
  if (!reader) throw new SyntaxError('Missing request body');
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_REQUEST_BYTES) {
        await reader.cancel();
        throw new RangeError('Request is too large');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export function priorMessages(input: AssistantRequest) {
  const history = [...input.conversationHistory];
  const last = history.at(-1);
  // Old clients included the current message in history as well as `message`.
  if (last?.role === 'user' && last.content === input.message) history.pop();
  return history;
}

/** Every topic the model may return; derived from the reviewed packets so the enum cannot drift. */
export const GUIDANCE_TOPICS = [...SELECTABLE_TOPICS, 'not-supported'] as const;

export const modelSelectionSchema = z.object({
  topic: z.enum(GUIDANCE_TOPICS),
  missingFactIds: z.array(z.string().max(80)).max(5),
  photoCategories: z.array(z.enum(['vehicle', 'receipt', 'workspace', 'equipment', 'food', 'unclear'])).max(3),
}).strict();

export type GuidanceTopic = z.infer<typeof modelSelectionSchema>['topic'];

export interface ModelAssessment {
  status: 'needs_details' | 'conditional' | 'not_supported';
  answer: string;
  photoObservations: string[];
  questions: string[];
  sourceIds: string[];
}
