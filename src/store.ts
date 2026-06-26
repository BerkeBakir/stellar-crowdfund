import { create } from 'zustand';
import type { ChainEvent } from '@/lib/events';

export type TxStatus = 'idle' | 'pending' | 'success' | 'fail';

type AppState = {
  publicKey: string | null;
  connected: boolean;
  txStatus: TxStatus;
  lastTxHash: string | null;
  lastError: string | null;
  campaigns: string[];
  events: ChainEvent[];
  setWallet: (pk: string | null) => void;
  setTxStatus: (s: TxStatus) => void;
  setTxResult: (hash: string | null, error: string | null) => void;
  setCampaigns: (c: string[]) => void;
  addEvents: (e: ChainEvent[]) => void;
};

export const useAppStore = create<AppState>((set) => ({
  publicKey: null, connected: false, txStatus: 'idle',
  lastTxHash: null, lastError: null, campaigns: [], events: [],
  setWallet: (pk) => set({ publicKey: pk, connected: pk !== null }),
  setTxStatus: (s) => set({ txStatus: s }),
  setTxResult: (hash, error) => set({ lastTxHash: hash, lastError: error }),
  setCampaigns: (c) => set({ campaigns: c }),
  addEvents: (e) => set((st) => {
    if (e.length === 0) return st;
    const seen = new Set(st.events.map((x) => `${x.txHash}:${x.ledger}:${x.kind}:${x.topicAddr}`));
    const fresh = e.filter((x) => !seen.has(`${x.txHash}:${x.ledger}:${x.kind}:${x.topicAddr}`));
    if (fresh.length === 0) return st;
    return { events: [...fresh.reverse(), ...st.events].slice(0, 50) };
  }),
}));
