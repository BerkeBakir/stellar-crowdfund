'use client';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { getSummary, contribute, claim, refund, contributionOf, type Summary } from '@/lib/campaign';
import { useAppStore } from '@/store';
import { stroopsToXlm, xlmToStroops, pct, timeLeft, truncate } from '@/lib/format';
import { explorerContractUrl } from '@/lib/config';
import TxStatus from './TxStatus';
import ReputationBadge from './ReputationBadge';

export default function CampaignDetail({ id }: { id: string }) {
  const { connected, publicKey, events, setTxStatus, setTxResult } = useAppStore();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [myContribution, setMyContribution] = useState<bigint>(0n);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const now = Math.floor(Date.now() / 1000);

  const refresh = useCallback(async () => {
    try {
      const s = await getSummary(id);
      setSummary(s);
      if (publicKey) setMyContribution(await contributionOf(id, publicKey));
    } catch { /* ignore */ }
  }, [id, publicKey]);

  useEffect(() => { refresh(); }, [refresh, events]);

  async function run(action: () => Promise<string>, label: string) {
    if (!publicKey) return;
    setBusy(true); setTxStatus('pending'); setTxResult(null, null);
    try {
      const hash = await action();
      setTxResult(hash, null); setTxStatus('success'); toast.success(`${label} succeeded`);
      await refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : `${label} failed`;
      setTxResult(null, msg); setTxStatus('fail'); toast.error(msg);
    } finally { setBusy(false); }
  }

  if (!summary) return <p className="text-sm opacity-60">Loading campaign…</p>;

  const percent = pct(summary.raised, summary.goal);
  const ended = now > summary.deadline;
  const goalMet = summary.raised >= summary.goal;
  const isCreator = publicKey === summary.creator;
  const active = summary.status === 0;
  const notClaimed = summary.status !== 1;
  let amtOk = false; try { amtOk = xlmToStroops(amount) > 0n; } catch { amtOk = false; }

  const canContribute = connected && active && !ended && amtOk && !busy;
  const canClaim = connected && isCreator && active && ended && goalMet && !busy;
  const canRefund = connected && notClaimed && ended && !goalMet && myContribution > 0n && !busy;

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="font-mono opacity-70">by {truncate(summary.creator)}</span>
          <ReputationBadge creator={summary.creator} />
        </div>
        <div className="mb-1 text-lg font-semibold">{stroopsToXlm(summary.raised)} / {stroopsToXlm(summary.goal)} XLM</div>
        <div className="h-2 w-full overflow-hidden rounded bg-white/10"><div className="h-full bg-green-500" style={{ width: `${percent}%` }} /></div>
        <div className="mt-1 flex justify-between text-xs opacity-70"><span>{percent}%</span><span>{timeLeft(summary.deadline, now)}</span></div>
        <a href={explorerContractUrl(id)} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-xs text-blue-400 underline">Contract on Stellar Expert</a>
      </div>

      {active && !ended && (
        <div className="flex flex-col gap-2 rounded-lg border p-4">
          <label className="text-sm font-medium">Contribute (XLM)</label>
          <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="1" className="rounded border bg-transparent px-3 py-2" />
          <button onClick={() => run(() => contribute(publicKey!, id, xlmToStroops(amount)), 'Contribution')} disabled={!canContribute} className="rounded bg-white px-4 py-2 font-medium text-black disabled:opacity-40">{busy ? 'Sending…' : 'Contribute'}</button>
          {!connected && <span className="text-xs opacity-60">Connect a wallet first.</span>}
        </div>
      )}

      {ended && goalMet && isCreator && active && (
        <button onClick={() => run(() => claim(publicKey!, id), 'Claim')} disabled={!canClaim} className="rounded bg-green-600 px-4 py-2 font-medium disabled:opacity-40">{busy ? 'Claiming…' : 'Claim funds'}</button>
      )}
      {ended && !goalMet && myContribution > 0n && (
        <button onClick={() => run(() => refund(publicKey!, id), 'Refund')} disabled={!canRefund} className="rounded border px-4 py-2 font-medium disabled:opacity-40">{busy ? 'Refunding…' : `Refund my ${stroopsToXlm(myContribution)} XLM`}</button>
      )}

      <TxStatus />
    </div>
  );
}
