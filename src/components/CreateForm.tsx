'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { createCampaign } from '@/lib/factory';
import { useAppStore } from '@/store';
import { xlmToStroops } from '@/lib/format';
import { explorerTxUrl } from '@/lib/config';

export default function CreateForm() {
  const router = useRouter();
  const { connected, publicKey } = useAppStore();
  const [goal, setGoal] = useState('');
  const [days, setDays] = useState('7');
  const [busy, setBusy] = useState(false);

  let goalOk = false;
  try { goalOk = xlmToStroops(goal) > 0n; } catch { goalOk = false; }
  const daysOk = /^\d+$/.test(days) && Number(days) >= 1;
  const canSubmit = connected && goalOk && daysOk && !busy;

  async function submit() {
    if (!publicKey) return;
    setBusy(true);
    try {
      const goalStroops = xlmToStroops(goal);
      const deadline = Math.floor(Date.now() / 1000) + Number(days) * 86400;
      const hash = await createCampaign(publicKey, goalStroops, deadline);
      toast.success('Campaign created!');
      toast.message('Tx', { description: explorerTxUrl(hash) });
      router.push('/');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to create campaign.');
    } finally { setBusy(false); }
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4">
      <label className="text-sm font-medium">Goal (XLM)</label>
      <input value={goal} onChange={(e) => setGoal(e.target.value)} inputMode="decimal" placeholder="10" className="rounded border bg-transparent px-3 py-2" />
      {goal !== '' && !goalOk && <span className="text-xs text-red-400">Enter a positive amount (max 7 decimals).</span>}
      <label className="text-sm font-medium">Duration (days)</label>
      <input value={days} onChange={(e) => setDays(e.target.value)} inputMode="numeric" className="rounded border bg-transparent px-3 py-2" />
      {!daysOk && <span className="text-xs text-red-400">At least 1 day.</span>}
      <button onClick={submit} disabled={!canSubmit} className="rounded bg-white px-4 py-2 font-medium text-black disabled:opacity-40">
        {busy ? 'Creating…' : 'Create campaign'}
      </button>
      {!connected && <span className="text-xs opacity-60">Connect a wallet first.</span>}
    </div>
  );
}
