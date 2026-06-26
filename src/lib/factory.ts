import { simulateRead, invoke, nativeToScVal, Address } from './soroban';
import { FACTORY_ID } from './config';

export async function listCampaigns(): Promise<string[]> {
  const raw = (await simulateRead(FACTORY_ID, 'list_campaigns')) as unknown[];
  return (raw ?? []).map((a) => String(a));
}

export async function createCampaign(pk: string, goal: bigint, deadline: number): Promise<string> {
  return invoke(pk, FACTORY_ID, 'create_campaign', [
    new Address(pk).toScVal(),
    nativeToScVal(goal, { type: 'i128' }),
    nativeToScVal(BigInt(deadline), { type: 'u64' }),
  ]);
}
