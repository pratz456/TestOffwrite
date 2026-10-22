import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/firebase/api-client', () => ({ makeAuthenticatedRequest: vi.fn(async () => ({ ok: false })) }));

import { DocumentImportSavePanel, ImportSavedNotice, importChoiceFromCommitError, importVerifyFieldDefs, savedMiscPausesEstimate } from '@/components/document-import-screen';
import { MISC_ESTIMATE_PAUSED_MESSAGE } from '@/lib/tax-rules/misc-estimate-pause';

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
    const question = html.slice(questionAt, html.indexOf('</p>', questionAt));
    expect(question).toBe('This looks like it could be a 1099. Which form is it?');
    expect(question).not.toMatch(/\d{2}-\d{7}|\d{3}-\d{2}-\d{4}|\b\d{9}\b/);
  });

  it('asks which kind of 1099 only when the variant is unclear and keeps Save disabled until it is answered', () => {
    const render = (choice: 'w2' | '1099' | null, needs1099Variant: boolean, variantChoice: 'NEC' | 'MISC' | null) => renderToStaticMarkup(
      <DocumentImportSavePanel
        notes={['Check the employer/payer ID']}
        needsTypeConfirmation
        needs1099Variant={needs1099Variant}
        choice={choice}
        variantChoice={variantChoice}
        onChoice={() => {}}
        onVariantChoice={() => {}}
        saveDisabled={false}
        saving={false}
        saveLabel="Save Verified Data to WriteOff"
        onSave={() => {}}
      >
        <p>Box 1 wages</p>
      </DocumentImportSavePanel>,
    );
    const saveButton = (html: string) => buttons(html).find(button => button.includes('Save Verified Data to WriteOff'));
    expect(render(null, true, null)).not.toContain('Which kind of 1099 is it?');
    expect(render('w2', true, null)).not.toContain('Which kind of 1099 is it?');
    const known = render('1099', false, null);
    expect(known).not.toContain('Which kind of 1099 is it?');
    expect(saveButton(known)).not.toMatch(/disabled=""/);

    const waiting = render('1099', true, null);
    const questionAt = waiting.indexOf('Which kind of 1099 is it?');
    const fieldAt = waiting.indexOf('Box 1 wages');
    const saveAt = waiting.indexOf('Save Verified Data to WriteOff');
    expect(questionAt).toBeGreaterThan(waiting.indexOf('This looks like it could be a 1099. Which form is it?'));
    expect(questionAt).toBeLessThan(fieldAt);
    expect(fieldAt).toBeLessThan(saveAt);
    const kindButtons = buttons(waiting).filter(button => button.includes('NEC (pay for work)') || button.includes('MISC (other income)'));
    expect(kindButtons).toHaveLength(2);
    expect(kindButtons[0]).toContain('NEC (pay for work)');
    expect(waiting.indexOf('NEC (pay for work)')).toBeLessThan(waiting.indexOf('MISC (other income)'));
    for (const button of kindButtons) {
      expect(button).toContain('bg-card');
      expect(button).toContain('border-border');
      expect(button).toContain('w-full');
      expect(button).toContain('sm:flex-1');
      expect(button).toContain('aria-pressed="false"');
      expect(button).not.toContain('bg-primary text-white');
    }
    expect(waiting).toContain('flex flex-col gap-2 sm:flex-row');
    expect(saveButton(waiting)).toMatch(/disabled=""/);
    expect(saveButton(render('1099', true, 'NEC'))).not.toMatch(/disabled=""/);
    expect(saveButton(render('1099', true, 'MISC'))).toMatch(/disabled=""/);
    expect(waiting).not.toMatch(/audit-proof|IRS-ready|guaranteed/i);
  });

  it('shows a MISC amount with box 3 unselected and keeps Save disabled until that box is picked', () => {
    const render = (miscBox: '3' | null) => renderToStaticMarkup(
      <DocumentImportSavePanel
        notes={['Check the employer/payer ID']}
        needsTypeConfirmation
        needsMiscBox
        choice="1099"
        miscBox={miscBox}
        miscAmount={1500}
        onChoice={() => {}}
        onMiscBox={() => {}}
        saveDisabled={false}
        saving={false}
        saveLabel="Save Verified Data to WriteOff"
        onSave={() => {}}
      >
        <p>Amount</p>
      </DocumentImportSavePanel>,
    );
    const waiting = render(null);
    const questionAt = waiting.indexOf('Which box is this amount?');
    const amountAt = waiting.indexOf('$1,500.00');
    const fieldAt = waiting.indexOf('>Amount<');
    const saveAt = waiting.indexOf('Save Verified Data to WriteOff');
    expect(questionAt).toBeGreaterThan(waiting.indexOf('This looks like it could be a 1099. Which form is it?'));
    expect(amountAt).toBeGreaterThan(questionAt);
    expect(amountAt).toBeLessThan(fieldAt);
    expect(fieldAt).toBeLessThan(saveAt);
    expect(waiting).toContain('Other income (box 3)');
    expect(waiting).not.toMatch(/Rents/);
    expect(waiting).not.toContain('Nonemployee compensation (box 1)');
    const boxButton = buttons(waiting).find(button => button.includes('Other income (box 3)'));
    expect(boxButton).toContain('aria-pressed="false"');
    expect(boxButton).toContain('bg-card');
    expect(boxButton).toContain('border-border');
    expect(buttons(waiting).some(button => button.includes('Rents'))).toBe(false);
    const saveButton = buttons(waiting).find(button => button.includes('Save Verified Data to WriteOff'));
    expect(saveButton).toMatch(/disabled=""/);
    const picked = render('3');
    const pickedBox = buttons(picked).find(button => button.includes('Other income (box 3)'));
    expect(pickedBox).toContain('aria-pressed="true"');
    expect(pickedBox).toContain('bg-primary text-white');
    expect(buttons(picked).find(button => button.includes('Save Verified Data to WriteOff'))).not.toMatch(/disabled=""/);
    expect(waiting).not.toMatch(/audit-proof|IRS-ready|guaranteed/i);
  });

  it('shows the matching question when a save returns a choice code and keeps Save disabled', () => {
    const typeChoice = importChoiceFromCommitError({ code: 'TYPE_CHOICE_REQUIRED' });
    expect(typeChoice).toEqual({ needsTypeConfirmation: true });
    const typeHtml = renderToStaticMarkup(
      <DocumentImportSavePanel
        notes={[]}
        needsTypeConfirmation
        choice={null}
        onChoice={() => {}}
        saveDisabled={false}
        saving={false}
        saveLabel="Save Verified Data to WriteOff"
        onSave={() => {}}
      >
        <p>Box 1 wages</p>
      </DocumentImportSavePanel>,
    );
    expect(typeHtml).toContain('This looks like it could be a 1099. Which form is it?');
    expect(buttons(typeHtml).find(button => button.includes('Save Verified Data to WriteOff'))).toMatch(/disabled=""/);

    const variantChoice = importChoiceFromCommitError({ code: 'VARIANT_CHOICE_REQUIRED' });
    expect(variantChoice?.needs1099Variant).toBe(true);
    expect(variantChoice?.confirmedDocType).toBe('1099');
    const variantHtml = renderToStaticMarkup(
      <DocumentImportSavePanel
        notes={[]}
        needsTypeConfirmation
        needs1099Variant
        choice="1099"
        variantChoice={null}
        onChoice={() => {}}
        onVariantChoice={() => {}}
        saveDisabled={false}
        saving={false}
        saveLabel="Save Verified Data to WriteOff"
        onSave={() => {}}
      >
        <p>Box 1 wages</p>
      </DocumentImportSavePanel>,
    );
    expect(variantHtml.indexOf('NEC (pay for work)')).toBeLessThan(variantHtml.indexOf('MISC (other income)'));
    expect(variantHtml).toContain('Which kind of 1099 is it?');
    expect(buttons(variantHtml).find(button => button.includes('Save Verified Data to WriteOff'))).toMatch(/disabled=""/);

    const miscChoice = importChoiceFromCommitError({ code: 'MISC_BOX_CHOICE_REQUIRED' });
    expect(miscChoice).toMatchObject({ needsMiscBox: true, confirmedDocType: '1099', confirmed1099Variant: 'MISC' });
    const miscHtml = renderToStaticMarkup(
      <DocumentImportSavePanel
        notes={[]}
        needsTypeConfirmation
        needsMiscBox
        choice="1099"
        variantChoice="MISC"
        miscBox={null}
        miscAmount={1500}
        onChoice={() => {}}
        onMiscBox={() => {}}
        saveDisabled={false}
        saving={false}
        saveLabel="Save Verified Data to WriteOff"
        onSave={() => {}}
      >
        <p>Amount</p>
      </DocumentImportSavePanel>,
    );
    expect(miscHtml).toContain('Which box is this amount?');
    expect(miscHtml).toContain('$1,500.00');
    expect(miscHtml).not.toMatch(/Rents/);
    expect(buttons(miscHtml).find(button => button.includes('Save Verified Data to WriteOff'))).toMatch(/disabled=""/);
    expect(importChoiceFromCommitError({ code: 'OTHER' })).toBeNull();
  });

  it('uses 1099 labels after 1099 is picked and does not call a MISC amount box 1', () => {
    const labels = (variant: 'NEC' | 'MISC' | null, needsMiscBox = false) => importVerifyFieldDefs({
      requestedType: 'w2',
      confirmedDocType: '1099',
      variant,
      needsMiscBox,
      fields: { box1Wages: 1200, box2FederalWithheld: 80, box3SocialSecurityWages: 1200, employerEIN: '98-7654321' },
    }).map(def => def.label);
    const nec = labels('NEC');
    expect(nec).toContain('Nonemployee compensation (box 1)');
    expect(nec).toContain('Federal income tax withheld (box 4)');
    expect(nec.some(label => /Social security|Medicare|Wages, Tips/i.test(label))).toBe(false);
    const misc = labels(null, true);
    expect(misc).toContain('Amount');
    expect(misc).not.toContain('Nonemployee compensation (box 1)');
    expect(misc.some(label => /Rents/i.test(label))).toBe(false);
    const html = renderToStaticMarkup(
      <DocumentImportSavePanel
        notes={[]}
        needsTypeConfirmation
        choice="1099"
        onChoice={() => {}}
        saveDisabled={false}
        saving={false}
        saveLabel="Save Verified Data to WriteOff"
        onSave={() => {}}
      >
        {nec.map(label => <p key={label}>{label}</p>)}
      </DocumentImportSavePanel>,
    );
    const questionAt = html.indexOf('This looks like it could be a 1099. Which form is it?');
    const labelAt = html.indexOf('Nonemployee compensation (box 1)');
    const withheldAt = html.indexOf('Federal income tax withheld (box 4)');
    expect(questionAt).toBeLessThan(labelAt);
    expect(labelAt).toBeLessThan(withheldAt);
    expect(withheldAt).toBeLessThan(html.indexOf('Save Verified Data to WriteOff'));
  });

  it('marks the clicked form button as selected and leaves the other unselected', () => {
    let choice: 'w2' | '1099' | null = null;
    const view = (current: 'w2' | '1099' | null) => DocumentImportSavePanel({
      notes: ['Check the employer/payer ID'],
      needsTypeConfirmation: true,
      choice: current,
      onChoice: next => { choice = next; },
      saveDisabled: false,
      saving: false,
      saveLabel: 'Save Verified Data to WriteOff',
      onSave: () => {},
      children: <p>Box 1 wages</p>,
    });
    const target = walk(view(null)).find(node => node.props?.['aria-pressed'] === false && textOf(node).includes('1099') && !textOf(node).includes('Which'));
    expect(target).toBeTruthy();
    target.props.onClick();
    expect(choice).toBe('1099');
    const [w2, form1099] = buttons(renderToStaticMarkup(view(choice)));
    expect(form1099).toContain('aria-pressed="true"');
    expect(form1099).toContain('bg-primary text-white');
    expect(w2).toContain('aria-pressed="false"');
    expect(w2).toContain('bg-card');
    expect(w2).not.toContain('bg-primary text-white');
  });

  it('marks the clicked 1099 kind as selected and leaves the other unselected', () => {
    let variant: 'NEC' | 'MISC' | null = null;
    const view = (current: 'NEC' | 'MISC' | null) => DocumentImportSavePanel({
      notes: [],
      needsTypeConfirmation: true,
      needs1099Variant: true,
      choice: '1099',
      variantChoice: current,
      onChoice: () => {},
      onVariantChoice: next => { variant = next; },
      saveDisabled: false,
      saving: false,
      saveLabel: 'Save Verified Data to WriteOff',
      onSave: () => {},
      children: <p>Box 1 wages</p>,
    });
    const target = walk(view(null)).find(node => node.props?.['aria-pressed'] === false && textOf(node).includes('MISC (other income)'));
    expect(target).toBeTruthy();
    target.props.onClick();
    expect(variant).toBe('MISC');
    const html = renderToStaticMarkup(view(variant));
    const misc = buttons(html).find(button => button.includes('MISC (other income)'))!;
    const nec = buttons(html).find(button => button.includes('NEC (pay for work)'))!;
    expect(misc).toContain('aria-pressed="true"');
    expect(misc).toContain('bg-primary text-white');
    expect(nec).toContain('aria-pressed="false"');
    expect(nec).not.toContain('bg-primary text-white');
  });

  it('marks box 3 as selected after it is clicked', () => {
    let miscBox: '3' | null = null;
    const view = (current: '3' | null) => DocumentImportSavePanel({
      notes: [],
      needsTypeConfirmation: true,
      needsMiscBox: true,
      choice: '1099',
      miscBox: current,
      miscAmount: 1500,
      onChoice: () => {},
      onMiscBox: next => { miscBox = next; },
      saveDisabled: false,
      saving: false,
      saveLabel: 'Save Verified Data to WriteOff',
      onSave: () => {},
      children: <p>Amount</p>,
    });
    const target = walk(view(null)).find(node => node.props?.['aria-pressed'] === false && textOf(node).includes('Other income (box 3)'));
    expect(target).toBeTruthy();
    target.props.onClick();
    expect(miscBox).toBe('3');
    const picked = buttons(renderToStaticMarkup(view(miscBox))).find(button => button.includes('Other income (box 3)'))!;
    expect(picked).toContain('aria-pressed="true"');
    expect(picked).toContain('bg-primary text-white');
  });

  it('shows the pause sentence after a 1099-MISC save and not after an NEC save', () => {
    expect(savedMiscPausesEstimate({ confirmed1099Variant: 'MISC', confirmedMiscBox: null })).toBe(true);
    expect(savedMiscPausesEstimate({ confirmed1099Variant: null, confirmedMiscBox: '3' })).toBe(true);
    expect(savedMiscPausesEstimate({ confirmed1099Variant: null, confirmedMiscBox: null, extractedFormVariant: 'MISC' })).toBe(true);
    expect(savedMiscPausesEstimate({ confirmed1099Variant: 'NEC', confirmedMiscBox: null })).toBe(false);
    const misc = renderToStaticMarkup(
      <ImportSavedNotice docKind="1099" savedMisc onImportAnother={() => {}} onViewPreview={() => {}} />,
    );
    expect(misc.replace(/&#x27;|&#39;|&apos;/g, "'")).toContain(MISC_ESTIMATE_PAUSED_MESSAGE);
    expect(misc).toContain('Saved to WriteOff');
    expect(misc).not.toContain('Remove this record');
    const nec = renderToStaticMarkup(
      <ImportSavedNotice docKind="1099" savedMisc={false} onImportAnother={() => {}} />,
    );
    expect(nec).not.toContain(MISC_ESTIMATE_PAUSED_MESSAGE);
    expect(nec).not.toContain('Remove this record');
  });
});

function walk(node: React.ReactNode): React.ReactElement[] {
  if (Array.isArray(node)) return node.flatMap(walk);
  if (!node || typeof node !== 'object' || !('props' in node)) return [];
  const element = node as React.ReactElement<{ children?: React.ReactNode }>;
  return [element, ...walk(element.props?.children)];
}

function textOf(node: React.ReactElement): string {
  const children = node.props?.children;
  if (typeof children === 'string') return children;
  if (Array.isArray(children)) return children.map(child => typeof child === 'string' ? child : '').join('');
  return '';
}
