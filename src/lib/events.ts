import { scValToNative, xdr } from '@stellar/stellar-sdk';
import { server } from './soroban';

export type EventKind = 'created' | 'contrib' | 'goal_met' | 'claimed' | 'refunded' | 'rep_up';
export type ChainEvent = {
  kind: EventKind; contract: string; topicAddr: string; value: string; ledger: number; txHash: string;
};

const KINDS: Record<string, EventKind> = {
  created: 'created', contrib: 'contrib', goal_met: 'goal_met',
  claimed: 'claimed', refunded: 'refunded', rep_up: 'rep_up',
};

export async function fetchLatestLedger(): Promise<number> {
  return (await server.getLatestLedger()).sequence;
}

export async function getCampaignEvents(
  startLedger: number, contractIds: string[]
): Promise<{ events: ChainEvent[]; latestLedger: number }> {
  if (contractIds.length === 0) return { events: [], latestLedger: startLedger };
  const resp = await server.getEvents({
    startLedger,
    filters: [{ type: 'contract', contractIds, topics: [['*', '*']] }],
  });
  const events: ChainEvent[] = [];
  for (const e of resp.events ?? []) {
    try {
      const topics = (e.topic as xdr.ScVal[]).map((t) => scValToNative(t));
      const kind = KINDS[String(topics[0])];
      if (!kind) continue;
      const value = scValToNative(e.value);
      events.push({
        kind,
        contract: e.contractId?.toString() ?? '',
        topicAddr: topics[1] != null ? String(topics[1]) : '',
        value: typeof value === 'bigint' ? value.toString() : String(value),
        ledger: e.ledger,
        txHash: e.txHash ?? '',
      });
    } catch { /* skip undecodable */ }
  }
  return { events, latestLedger: resp.latestLedger };
}
