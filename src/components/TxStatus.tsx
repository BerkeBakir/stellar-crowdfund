'use client';
import { useAppStore } from '@/store';
import { explorerTxUrl } from '@/lib/config';

export default function TxStatus() {
  const { txStatus, lastTxHash, lastError } = useAppStore();
  if (txStatus === 'idle') return null;
  if (txStatus === 'pending') return <div className="rounded border border-yellow-600 p-2 text-sm">⏳ Transaction pending…</div>;
  if (txStatus === 'fail') return <div className="rounded border border-red-600 p-2 text-sm text-red-400">❌ {lastError ?? 'Transaction failed.'}</div>;
  return (
    <div className="rounded border border-green-600 p-2 text-sm">
      ✅ Success!{lastTxHash && (<> <a href={explorerTxUrl(lastTxHash)} target="_blank" rel="noopener noreferrer" className="text-blue-400 underline">View on Stellar Expert</a></>)}
    </div>
  );
}
