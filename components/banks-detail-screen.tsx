"use client";

import Link from 'next/link';
import type { ReconnectView } from '@/lib/plaid/reconnect-contract';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Building2, Plus, RefreshCw, Unplug } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { makeAuthenticatedRequest } from '@/lib/firebase/api-client';
import { notifyProfileUpdated } from '@/lib/onboarding/profile-events';
import { toast } from 'sonner';

type BankItem = {
  itemId: string;
  accountIds: string[];
  institutionId: string | null;
  lastSync?: number;
  status: 'active' | 'relink_required' | 'pending_history_review';
  reconnectSessionId?: string | null;
  relinkRequired: boolean;
  reauthenticationRequired?: boolean;
};
type BankAccount = {
  id?: string;
  account_id?: string;
  name?: string;
  mask?: string;
  type?: string;
  subtype?: string;
  plaid_item_id?: string;
  balance?: number | null;
  available_balance?: number | null;
  current_balance?: number | null;
  iso_currency_code?: string | null;
};
interface BanksDetailScreenProps {
  user: { id: string; email?: string; user_metadata?: { name?: string } };
  onBack: () => void;
  onConnectBank: (itemId?: string) => void;
  bankConnected?: boolean;
}

function accountKey(account: BankAccount) { return account.account_id || account.id || ''; }
function formatBalance(account: BankAccount) {
  const amount = account.balance ?? account.available_balance ?? account.current_balance;
  if (amount == null || !Number.isFinite(amount)) return 'Unavailable';
  const currency = account.iso_currency_code;
  if (!currency) return `${amount.toFixed(2)} · currency unknown`;
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount); }
  catch { return `${amount.toFixed(2)} ${currency}`; }
}

export const BanksDetailScreen: React.FC<BanksDetailScreenProps> = ({ user, onBack, onConnectBank }) => {
  const loadGeneration = useRef(0);
  const [loadedOwner, setLoadedOwner] = useState<string | null>(null);
  const [storedAccounts, setAccounts] = useState<BankAccount[]>([]);
  const [storedItems, setItems] = useState<BankItem[]>([]);
  const [storedReconnect, setReconnect] = useState<ReconnectView | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [disconnectItem, setDisconnectItem] = useState<BankItem | null>(null);

  const accounts = loadedOwner === user.id ? storedAccounts : [];
  const reconnect = loadedOwner === user.id ? storedReconnect : null;
  const items = loadedOwner === user.id ? storedItems : [];
  const load = useCallback(async () => {
    const generation = ++loadGeneration.current;
    setError(null);
    try {
      const responses = await Promise.all([
        makeAuthenticatedRequest('/api/plaid/items'),
        makeAuthenticatedRequest('/api/database/accounts'),
        makeAuthenticatedRequest('/api/plaid/reconnect', { cache: 'no-store' }).then(async response => response.ok ? response.json() : null).catch(() => null),
      ]);
      const [connectionData, accountData] = await Promise.all(responses.slice(0, 2).map(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Could not load bank accounts.');
        return data;
      }));
      if (generation !== loadGeneration.current) return;
      setLoadedOwner(user.id);
      setItems(connectionData.items || []);
      setAccounts(accountData.accounts || []);
      setReconnect(responses[2]?.reconnect || null);
    } catch (err) {
      if (generation === loadGeneration.current) setError(err instanceof Error ? err.message : 'Could not load bank accounts.');
    } finally { if (generation === loadGeneration.current) setLoading(false); }
  }, [user.id]);
  useEffect(() => { setLoading(true); void load(); return () => { ++loadGeneration.current; }; }, [load]);

  const accountsFor = (item: BankItem) => accounts.filter(account =>
    account.plaid_item_id === item.itemId || item.accountIds.includes(accountKey(account)));
  const itemName = (item: BankItem) => accountsFor(item)[0]?.name || 'Bank connection';
  const activeItems = items.filter(item => item.status === 'active' && !item.relinkRequired);
  const savedAccounts = accounts.filter(account => !items.some(item =>
    account.plaid_item_id === item.itemId || item.accountIds.includes(accountKey(account))));

  const sync = async (itemId?: string) => {
    setBusy(itemId || 'sync-all');
    try {
      const response = await makeAuthenticatedRequest('/api/plaid/sync-transactions', {
        method: 'POST', body: JSON.stringify({ incremental: true, ...(itemId ? { itemId } : {}) }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not sync this bank.');
      toast.success(data.status === 'already_running' ? 'Sync is already in progress.' :
        `${data.transactions_saved || 0} new transactions saved. Eligible records are queued for AI review.`);
      await load();
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Bank sync failed.'); }
    finally { setBusy(null); }
  };

  const disconnect = async () => {
    if (!disconnectItem) return;
    const target = disconnectItem;
    setDisconnectItem(null);
    setBusy(target.itemId);
    try {
      const response = await makeAuthenticatedRequest(`/api/plaid/items/${encodeURIComponent(target.itemId)}`, { method: 'DELETE' });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Could not disconnect this bank.');
      toast.success('Bank disconnected. Your saved accounts and transactions are still available.');
      notifyProfileUpdated(user.id);
      await load();
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Could not disconnect this bank.'); }
    finally { setBusy(null); }
  };

  const accountRow = (account: BankAccount) => (
    <div key={accountKey(account)} className="flex items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">{account.name || 'Saved account'}</p>
        <p className="text-xs text-slate-500">{account.subtype || account.type || 'Account'}{account.mask ? ` · ••${account.mask}` : ''}</p>
      </div>
      <div className="shrink-0 text-right">
        <p className="text-sm font-medium tabular-nums">{formatBalance(account)}</p>
        <p className="text-xs text-slate-500">Last saved balance</p>
      </div>
    </div>
  );

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-5 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" aria-label="Back" onClick={onBack}><ArrowLeft className="h-5 w-5" /></Button>
          <div><h1 className="text-xl font-semibold">Bank accounts</h1><p className="text-sm text-slate-500">{activeItems.length} connected · {accounts.length} saved accounts</p></div>
        </div>
        <Button onClick={() => onConnectBank()} className="gap-2"><Plus className="h-4 w-4" />Connect bank</Button>
      </header>
      <p className="text-sm text-slate-500">Bank activity syncs into your review queue. Confirm AI suggestions before using them in tax reports.</p>
      {reconnect && reconnect.phase !== 'cancelled' && (reconnect.phase !== 'active' || reconnect.pendingCount + reconnect.deferredCount > 0) && <Card className="space-y-3 p-4 sm:p-5">
        <h2 className="font-semibold">{reconnect.phase === 'active' ? 'Bank connected · history review remains' : 'Bank reconnect in progress'}</h2>
        <p className="text-sm text-slate-500">{reconnect.pendingCount} need a decision · {reconnect.deferredCount} set aside for later. Your review is saved.</p>
        <Button asChild variant="outline"><Link href={`/plaid/reconnect?sessionId=${encodeURIComponent(reconnect.sessionId)}`}>Resume history review</Link></Button>
      </Card>}
      {error && <Card role="alert" className="p-4 text-sm"><p>{error}</p><Button variant="outline" size="sm" className="mt-2" onClick={() => void load()}>Try again</Button></Card>}
      {loading && <p role="status" className="py-6 text-center text-sm text-slate-500">Loading bank accounts…</p>}
      {items.map(item => (
        <Card key={item.itemId} className="overflow-hidden p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 gap-3"><Building2 className="mt-0.5 h-5 w-5 shrink-0 text-blue-600" /><div className="min-w-0">
              <h2 className="truncate font-semibold">{itemName(item)}</h2>
              <p className={`text-xs ${item.relinkRequired ? 'text-amber-700' : 'text-emerald-700'}`}>{item.reauthenticationRequired ? 'Bank sign-in required' : item.status === 'pending_history_review' ? 'History review required' : item.relinkRequired ? 'Reconnect required' : 'Connected'}</p>
            </div></div>
            {!item.relinkRequired && <Button size="sm" variant="outline" disabled={!!busy} onClick={() => void sync(item.itemId)} className="gap-1.5"><RefreshCw className={`h-3.5 w-3.5 ${busy === item.itemId ? 'animate-spin' : ''}`} />Sync</Button>}
          </div>
          {item.relinkRequired && <p className="mt-3 text-sm text-slate-600">{item.reauthenticationRequired
            ? 'Sign in to this bank again to resume updates. Your saved records are retained.'
            : item.status === 'pending_history_review' ? 'Match your accounts and review saved history before activating this connection.'
            : 'WriteOff’s bank connection provider has changed. Connect this bank again to resume updates. Your saved records are retained.'}</p>}
          <div className="mt-2 divide-y divide-slate-100 dark:divide-slate-800">{accountsFor(item).map(accountRow)}</div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t pt-3">
            <span className="text-xs text-slate-500">{item.lastSync ? `Last sync ${new Date(item.lastSync).toLocaleString()}` : 'Waiting for bank updates'}</span>
            <div className="flex flex-wrap gap-2">
              {item.reconnectSessionId && <Button asChild size="sm" variant="outline"><Link href={`/plaid/reconnect?sessionId=${encodeURIComponent(item.reconnectSessionId)}`}>{item.status === 'pending_history_review' ? 'Resume history review' : 'History review'}</Link></Button>}
              {(item.status !== 'pending_history_review' || item.reauthenticationRequired) && <Button size="sm" variant="ghost" onClick={() => onConnectBank(item.relinkRequired && !item.reauthenticationRequired ? undefined : item.itemId)} disabled={!!busy}>{item.relinkRequired && !item.reauthenticationRequired ? 'Reconnect bank' : 'Repair connection'}</Button>}
              {item.status !== 'pending_history_review' && <Button size="sm" variant="ghost" aria-label={`Disconnect ${itemName(item)}`} onClick={() => setDisconnectItem(item)} disabled={!!busy}><Unplug className="mr-1.5 h-3.5 w-3.5" />Disconnect</Button>}
            </div>
          </div>
        </Card>
      ))}
      {savedAccounts.length > 0 && <Card className="p-4 sm:p-5"><h2 className="font-semibold">Saved accounts</h2><p className="mt-1 text-xs text-slate-500">Manual and disconnected accounts. Their records remain available.</p><div className="mt-2 divide-y divide-slate-100 dark:divide-slate-800">{savedAccounts.map(accountRow)}</div></Card>}
      {!loading && !error && !items.length && !accounts.length && <Card className="p-6 text-center"><Building2 className="mx-auto mb-3 h-7 w-7 text-slate-400" /><h2 className="font-semibold">Bring your transactions together</h2><p className="mt-1 text-sm text-slate-500">Connect a bank to import activity and start your AI review.</p></Card>}
      <p className="text-xs text-slate-500">Available history depends on your plan and bank. Disconnecting stops future updates and keeps saved records.</p>
      <ConfirmationDialog open={!!disconnectItem} onOpenChange={open => { if (!open) setDisconnectItem(null); }} title="Disconnect this bank?" description="This stops future updates for this bank’s accounts. Saved accounts and transactions will remain available." confirmLabel="Disconnect bank" variant="destructive" onConfirm={() => void disconnect()} />
    </div>
  );
};
