'use client';
import { useState } from 'react';
import { toast } from 'sonner';
import { openWalletModal, disconnect } from '@/lib/wallet';
import { fundAccount } from '@/lib/friendbot';
import { useAppStore } from '@/store';
import { truncate } from '@/lib/format';

export default function WalletBar() {
  const { publicKey, connected, setWallet } = useAppStore();
  const [busy, setBusy] = useState(false);

  async function connect() {
    setBusy(true);
    try { setWallet(await openWalletModal()); toast.success('Wallet connected.'); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Failed to connect.'); }
    finally { setBusy(false); }
  }
  async function handleDisconnect() {
    try { await disconnect(); } catch { /* ignore */ }
    setWallet(null);
  }
  async function fund() {
    if (!publicKey) return;
    setBusy(true);
    try { await fundAccount(publicKey); toast.success('Funded with Test XLM.'); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Funding failed.'); }
    finally { setBusy(false); }
  }

  if (!connected || !publicKey) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
        <span className="text-sm opacity-70">Connect a wallet</span>
        <button onClick={connect} disabled={busy} className="rounded bg-white px-4 py-2 text-sm font-medium text-black disabled:opacity-50">
          {busy ? 'Connecting…' : 'Connect Wallet'}
        </button>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
      <span className="font-mono text-sm">{truncate(publicKey)}</span>
      <div className="flex gap-2">
        <button onClick={fund} disabled={busy} className="rounded border px-3 py-1.5 text-sm disabled:opacity-50">{busy ? '…' : 'Get Test XLM'}</button>
        <button onClick={handleDisconnect} className="rounded border px-3 py-1.5 text-sm">Disconnect</button>
      </div>
    </div>
  );
}
