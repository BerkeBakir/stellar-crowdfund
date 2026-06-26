import { simulateRead, invoke, nativeToScVal, Address } from './soroban';

export type Summary = {
  creator: string; goal: bigint; deadline: number; raised: bigint; status: number;
};

export async function getSummary(id: string): Promise<Summary> {
  const t = (await simulateRead(id, 'summary')) as [string, bigint, bigint | number, bigint, number];
  return {
    creator: String(t[0]),
    goal: BigInt(t[1]),
    deadline: Number(t[2]),
    raised: BigInt(t[3]),
    status: Number(t[4]),
  };
}

export async function contributionOf(id: string, who: string): Promise<bigint> {
  const v = (await simulateRead(id, 'contribution_of', [new Address(who).toScVal()])) as bigint | number;
  return BigInt(v ?? 0);
}

export async function contribute(pk: string, id: string, amount: bigint): Promise<string> {
  return invoke(pk, id, 'contribute', [new Address(pk).toScVal(), nativeToScVal(amount, { type: 'i128' })]);
}
export async function claim(pk: string, id: string): Promise<string> {
  return invoke(pk, id, 'claim', []);
}
export async function refund(pk: string, id: string): Promise<string> {
  return invoke(pk, id, 'refund', [new Address(pk).toScVal()]);
}
