import { describe, expect, it } from 'vitest';
import {
  buildRollbackPlan,
  classifyDiff,
  classifyPath,
  PIPELINE_FILES,
  renderPlan,
  SURFACES,
} from '../scripts/production-rollback-plan.mjs';

const from = 'a'.repeat(40);
const to = 'b'.repeat(40);

describe('classifyPath', () => {
  it('maps every deploy surface exactly', () => {
    expect(classifyPath('firestore.rules')).toBe('firestore.rules');
    expect(classifyPath('firestore.indexes.json')).toBe('firestore.indexes.json');
    expect(classifyPath('storage.rules')).toBe('storage.rules');
    expect(classifyPath('functions/src/index.ts')).toBe('functions');
    expect(classifyPath('functions/package.json')).toBe('functions');
    expect(classifyPath('functions-analysis/src/bridge.ts')).toBe('functions-analysis');
    expect(classifyPath('firebase.json')).toBe('deploy-config');
    expect(classifyPath('.firebaserc')).toBe('deploy-config');
  });

  it('treats everything the Next build ships as hosting/app, including unknown paths', () => {
    for (const file of [
      'app/api/plaid/webhook/route.ts', 'lib/plaid/connections.ts', 'components/receipt-preview.tsx', 'ui/dialog.tsx',
      'worker/index.ts', 'public/manifest.json', 'middleware.ts', 'next.config.ts', 'package.json', 'package-lock.json',
      'tsconfig.json', 'content/blog/post.md', 'brand-new-directory/file.ts',
    ]) expect(classifyPath(file), file).toBe('hosting/app');
  });

  it('separates the release pipeline from ordinary scripts and tooling', () => {
    for (const file of PIPELINE_FILES) expect(classifyPath(file), file).toBe('release-pipeline');
    expect(classifyPath('scripts/production-migration-inventory.mjs')).toBe('release-pipeline');
    expect(classifyPath('.nvmrc')).toBe('release-pipeline');
    expect(classifyPath('scripts/production-observability.sh')).toBe('not-deployed');
    expect(classifyPath('scripts/production-rollback-plan.mjs')).toBe('not-deployed');
  });

  it('ignores docs, tests, staging configs, mobile and CI that never reach production', () => {
    for (const file of [
      'docs/PRODUCTION_ROLLBACK_2026-09-17.md', 'README.md', 'tests/production-rollback-plan.test.ts',
      'lib/plaid/connections.test.ts', 'app/__tests__/page.spec.tsx', 'firebase.staging.json', 'firebase.staging-auth.json',
      'mobile/app.json', '.github/workflows/ci.yml', 'eslint.config.mjs', 'vitest.config.mjs', 'tools/powershell/x.ps1', '.gcloudignore',
    ]) expect(classifyPath(file), file).toBe('not-deployed');
    expect(classifyPath('.github/workflows/deploy.yml')).toBe('release-pipeline');
  });

  it('normalizes Windows separators and leading ./', () => {
    expect(classifyPath('functions\\src\\index.ts')).toBe('functions');
    expect(classifyPath('./storage.rules')).toBe('storage.rules');
  });
});

describe('classifyDiff', () => {
  it('groups, de-duplicates and sorts a fake diff listing', () => {
    const result = classifyDiff([
      'lib/plaid/connections.ts', 'firestore.rules', 'functions-analysis/src/index.ts', 'docs/x.md', 'lib/plaid/connections.ts', 'app/page.tsx',
    ]);
    expect(Object.keys(result.bySurface)).toEqual(Object.keys(SURFACES));
    expect(result.bySurface['hosting/app']).toEqual(['app/page.tsx', 'lib/plaid/connections.ts']);
    expect(result.bySurface['firestore.rules']).toEqual(['firestore.rules']);
    expect(result.bySurface['functions-analysis']).toEqual(['functions-analysis/src/index.ts']);
    expect(result.bySurface['not-deployed']).toEqual(['docs/x.md']);
    expect(result.flags).toEqual({ appChanged: true, rulesChanged: true, indexesChanged: false, functionsChanged: true, configChanged: false, pipelineChanged: false });
    expect(result.appOnlyRollbackSafe).toBe(false);
  });

  it('allows an app-only rollback when only shipped app code changed', () => {
    const result = classifyDiff(['app/page.tsx', 'lib/tax/x.ts', 'docs/notes.md', 'tests/x.test.ts']);
    expect(result.flags.rulesChanged).toBe(false);
    expect(result.appOnlyRollbackSafe).toBe(true);
  });

  it('refuses an app-only rollback when storage rules, indexes, functions or firebase.json moved', () => {
    expect(classifyDiff(['storage.rules']).appOnlyRollbackSafe).toBe(false);
    expect(classifyDiff(['firestore.indexes.json']).appOnlyRollbackSafe).toBe(false);
    expect(classifyDiff(['functions/src/index.ts']).appOnlyRollbackSafe).toBe(false);
    expect(classifyDiff(['firebase.json']).appOnlyRollbackSafe).toBe(false);
    expect(classifyDiff(['firebase.json']).flags.appChanged).toBe(true);
  });

  it('handles an empty diff', () => {
    const result = classifyDiff([]);
    expect(Object.values(result.bySurface).every(list => list.length === 0)).toBe(true);
    expect(result.appOnlyRollbackSafe).toBe(true);
  });
});

describe('buildRollbackPlan', () => {
  it('states the rules rule and the workflow path when both commits carry the pipeline', () => {
    const plan = buildRollbackPlan({ from, to, files: ['firestore.rules', 'app/page.tsx'], generatedAt: '2026-09-17T00:00:00.000Z' });
    expect(plan.rule).toMatch(/UNSAFE to roll back the app alone/);
    expect(plan.summary).toMatchObject({ project: 'writeoff-23910', from, to, appOnlyRollbackSafe: false, rollbackPath: 'workflow_dispatch release_commit=<from>', changedSurfaces: { 'firestore.rules': 1, 'hosting/app': 1 } });
    expect(plan.sequence.some(step => step.includes(`release_commit=${from}`) && step.includes(`deploy:writeoff-23910:${from}`))).toBe(true);
    expect(plan.sequence.some(step => step.includes(`"commit": "${from}"`))).toBe(true);
    expect(plan.irreversible.join('\n')).toMatch(/migrateLegacyPlaidConnection/);
    expect(plan.irreversible.join('\n')).toMatch(/human_review_required/);
    expect(plan.irreversible.join('\n')).toMatch(/firestore-backups/);
  });

  it('switches to the console rollback path when the live commit predates the pipeline', () => {
    const plan = buildRollbackPlan({ from, to, files: ['firestore.rules'], fromHasPipeline: false });
    expect(plan.summary.rollbackPath).toBe('console rollback (pre-pipeline baseline)');
    expect(plan.sequence.join('\n')).toMatch(/Release history → Rollback/);
    expect(plan.sequence.join('\n')).toMatch(/gcloud functions delete queueBankTransactionAnalysis/);
    expect(plan.sequence.some(step => step.includes('release_commit='))).toBe(false);
  });

  it('reports compatibility when rules did not change', () => {
    const plan = buildRollbackPlan({ from, to, files: ['app/page.tsx'] });
    expect(plan.rule).toMatch(/Rules did not change/);
    expect(plan.appOnlyRollbackSafe).toBe(true);
  });

  it('renders every section and machine-readable evidence', () => {
    const text = renderPlan(buildRollbackPlan({ from, to, files: ['storage.rules', 'functions/src/index.ts', 'docs/a.md'], generatedAt: '2026-09-17T00:00:00.000Z' }));
    expect(text).toContain('## Surfaces changed');
    expect(text).toContain('- storage.rules (1)');
    expect(text).toContain('- functions (1)');
    expect(text).toContain('- not-deployed (1)');
    expect(text).toContain('app-only rollback safe: NO');
    expect(text).toContain('## Cannot be rolled back by redeploying code');
    const evidence = JSON.parse(text.split('## rollbackCompatibility evidence (paste into the migration review)\n')[1]);
    expect(evidence).toMatchObject({ schemaVersion: 1, from, to, flags: { rulesChanged: true, functionsChanged: true } });
  });
});
