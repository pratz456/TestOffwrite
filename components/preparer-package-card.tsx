'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { PremiumFeatureGate } from '@/components/premium-feature-gate';
import { makeAuthenticatedRequest } from '@/lib/firebase/api-client';
import { Download, Link2, Loader2, X } from 'lucide-react';

interface Handoff { id: string; taxYear: number; createdAt: number; expiresAt: number; revokedAt: number | null; receiptIssues: number }
export function PreparerPackageCard({ year, userId }: { year: number; userId: string }) {
  const [busy, setBusy] = useState<string | null>(null), [message, setMessage] = useState(''), [link, setLink] = useState('');
  const [handoffs, setHandoffs] = useState<Handoff[]>([]), [showShare, setShowShare] = useState(false), [confirm, setConfirm] = useState(false), [days, setDays] = useState('3');
  const context = `${userId}:${year}`, active = useRef(context), lock = useRef(false); active.current = context;
  const refresh = useCallback(async () => {
    const response = await makeAuthenticatedRequest('/api/preparer-handoffs');
    const data = await response.json().catch(() => ({}));
    if (active.current !== context) return;
    if (!response.ok) throw new Error(data.error || 'Could not load shared links.');
    setHandoffs(Array.isArray(data.handoffs) ? data.handoffs : []);
  }, [context]);
  useEffect(() => { setLink(''); setMessage(''); setConfirm(false); setShowShare(false); setHandoffs([]); void refresh().catch(() => { if (active.current === context) setMessage('Shared links could not be loaded. Reopen this section to retry.'); }); }, [refresh, context]);
  async function act(action: 'download' | 'share' | 'revoke', id?: string) {
    if (lock.current) return; lock.current = true; setBusy(id ?? action); setMessage('');
    try {
      const response = await makeAuthenticatedRequest(action === 'download' ? '/api/reports/preparer-package' : action === 'revoke' ? `/api/preparer-handoffs/${id}` : '/api/preparer-handoffs', {
        method: action === 'revoke' ? 'DELETE' : 'POST', ...(action === 'revoke' ? {} : { body: JSON.stringify(action === 'share' ? { year, expiresInDays: Number(days), confirmSharing: confirm } : { year }) }),
      });
      if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.error || 'Could not prepare the complete package.'); }
      if (active.current !== context) return;
      if (action === 'download') {
        const bytes = await response.blob(); if (active.current !== context) return;
        const url = URL.createObjectURL(bytes), anchor = document.createElement('a'); anchor.href = url;
        const issues = Number(response.headers.get('X-Receipt-Issues') ?? 0), questions = Number(response.headers.get('X-Unresolved-Transactions') ?? 0);
        anchor.download = `writeoff-preparer-${year}${issues ? '-receipt-review-needed' : ''}.zip`; document.body.appendChild(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(url);
        setMessage(`Downloaded. ${issues} receipt issue(s) and ${questions} transactions with unresolved questions are listed in the package.`);
      } else if (action === 'share') {
        const data = await response.json(); if (active.current !== context) return;
        setLink(new URL(data.path, window.location.origin).href);
        setMessage(`Link created. ${data.receiptFiles} receipt files included; ${data.receiptIssues} receipt issue(s) and ${data.unresolvedQuestions} transactions with unresolved questions remain.`);
        setConfirm(false); await refresh();
      } else { if (link.includes(`/preparer/${id}#`)) setLink(''); setMessage('Link revoked. Previously downloaded copies remain with the recipient.'); await refresh(); }
    } catch (error) { if (active.current === context) setMessage(error instanceof Error ? error.message : 'Please retry.'); }
    finally { lock.current = false; setBusy(null); }
  }
  const current = handoffs.filter(item => !item.revokedAt && item.expiresAt > Date.now());
  return <section className="rounded-2xl border border-border/70 bg-card p-4 space-y-3">
    <div><h3 className="text-sm font-semibold">Send your preparer one package</h3><p className="text-xs text-muted-foreground mt-1">Transactions, tax records, original receipts and unanswered questions for {year}.</p></div>
    <PremiumFeatureGate feature="exports" featureName="preparer packages">
      <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={!!busy} onClick={() => void act('download')}>{busy === 'download' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}Download ZIP</Button><Button size="sm" variant="outline" disabled={!!busy} onClick={() => setShowShare(value => !value)}><Link2 className="h-4 w-4" />Create private link</Button></div>
      {showShare && <div className="space-y-3 rounded-xl bg-muted/40 p-3 text-sm">
        <p>Includes personal tax records and unredacted original receipts. Anyone with the link can download this fixed snapshot until it expires or you revoke it. Downloaded copies cannot be recalled.</p>
        <label className="flex items-center gap-2">Expires in <select aria-label="Link expiry" value={days} onChange={event => setDays(event.target.value)} className="rounded-md border bg-background p-2">{[1, 3, 7].map(day => <option key={day} value={day}>{day} day{day > 1 ? 's' : ''}</option>)}</select></label>
        <label className="flex items-start gap-2"><input type="checkbox" checked={confirm} onChange={event => setConfirm(event.target.checked)} className="mt-1" />I want to create a link sharing these records and receipts.</label>
        <Button size="sm" disabled={!confirm || !!busy} onClick={() => void act('share')}>{busy === 'share' && <Loader2 className="h-4 w-4 animate-spin" />}Create link</Button>
      </div>}
    </PremiumFeatureGate>
    {link && <div className="space-y-2"><label className="text-xs font-medium" htmlFor="preparer-private-link">Copy and send this link to your preparer</label><input id="preparer-private-link" readOnly value={link} onFocus={event => event.target.select()} className="w-full min-w-0 rounded-lg border bg-background px-3 py-2 text-xs" /><p className="text-xs text-muted-foreground">Shown only now. We do not email it or save the secret link. Create a new link if you lose it.</p></div>}
    {!!current.length && <details><summary className="cursor-pointer text-xs font-medium">Manage {current.length} active link{current.length > 1 ? 's' : ''}</summary><ul className="mt-2 space-y-2">{current.map(item => <li key={item.id} className="flex items-center gap-2 text-xs"><span className="flex-1">{item.taxYear} snapshot · expires {new Date(item.expiresAt).toLocaleDateString()}</span><Button size="sm" variant="ghost" disabled={!!busy} onClick={() => void act('revoke', item.id)} aria-label={`Revoke ${item.taxYear} link created ${new Date(item.createdAt).toLocaleString()}`}>{busy === item.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}Revoke</Button></li>)}</ul></details>}
    {message && <p className="text-xs leading-relaxed" role="status">{message}</p>}
    <p className="text-xs text-muted-foreground">A preparer handoff does not file your return. Missing receipts are listed explicitly; records are never marked complete automatically.</p>
  </section>;
}
