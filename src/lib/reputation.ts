import { simulateRead, Address } from './soroban';
import { REPUTATION_ID } from './config';

export async function getScore(creator: string): Promise<number> {
  const v = (await simulateRead(REPUTATION_ID, 'get_score', [new Address(creator).toScVal()])) as number | bigint;
  return Number(v ?? 0);
}
