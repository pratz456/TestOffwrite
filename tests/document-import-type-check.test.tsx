import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/firebase/api-client', () => ({ makeAuthenticatedRequest: vi.fn(async () => ({ ok: false })) }));

import { DocumentImportSavePanel } from '@/components/document-import-screen';

const panel = (choice: 'w2' | '1099' | null) => renderToStaticMarkup(
  <DocumentImportSavePanel
    notes={['Check the employer/payer ID']}
    needsTypeConfirmation
    choice={choice}
    onChoice={() => {}}
    saveDisabled={false}
    saving={false}
    saveLabel="Save Verified Data to WriteOff"
    onSave={() => {}}
  >
    <p>Box 1 wages</p>
  </DocumentImportSavePanel>,
);

const buttons = (html: string) => [...html.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)].map(match => match[0]);

describe('W-2 or 1099 question on the verify panel', () => {
  it('keeps Save disabled until W-2 or 1099 is chosen', () => {
    const waiting = panel(null);
    const save = buttons(waiting).find(button => button.includes('Save Verified Data to WriteOff'));
    expect(save).toMatch(/disabled=""/);
    const pickedW2 = buttons(panel('w2')).find(button => button.includes('Save Verified Data to WriteOff'));
    const picked1099 = buttons(panel('1099')).find(button => button.includes('Save Verified Data to WriteOff'));
    expect(pickedW2).not.toMatch(/disabled=""/);
    expect(picked1099).not.toMatch(/disabled=""/);
  });

  it('shows the question with two equal secondary choices and no default, above the fields and Save', () => {
    const html = panel(null);
    const idAt = html.indexOf('Check the employer/payer ID');
    const questionAt = html.indexOf('This looks like it could be a 1099. Which form is it?');
    const fieldAt = html.indexOf('Box 1 wages');
    const saveAt = html.indexOf('Save Verified Data to WriteOff');
    expect(idAt).toBeGreaterThan(-1);
    expect(idAt).toBeLessThan(questionAt);
    expect(questionAt).toBeLessThan(fieldAt);
    expect(fieldAt).toBeLessThan(saveAt);

    const [w2, form1099] = buttons(html);
    expect(w2).toContain('>W-2<');
    expect(form1099).toContain('>1099<');
    for (const button of [w2, form1099]) {
      expect(button).toContain('bg-card');
      expect(button).toContain('border-border');
      expect(button).toContain('w-full');
      expect(button).toContain('sm:flex-1');
      expect(button).toContain('aria-pressed="false"');
      expect(button).not.toContain('bg-primary text-white');
      expect(button).not.toMatch(/disabled=""/);
    }
    expect(html).toContain('flex flex-col gap-2 sm:flex-row');
    expect(html).not.toMatch(/audit-proof|IRS-ready|guaranteed/i);
    expect(html).not.toMatch(/\d{2}-\d{7}|\b\d{9}\b/);
    const question = html.slice(questionAt, html.indexOf('>W-2<'));
    expect(question).not.toMatch(/\d/);
  });
});
