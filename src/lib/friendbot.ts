import { FRIENDBOT_URL } from './config';

export async function fundAccount(publicKey: string): Promise<void> {
  const res = await fetch(`${FRIENDBOT_URL}/?addr=${encodeURIComponent(publicKey)}`);
  if (res.ok) return;
  const body = await res.text().catch(() => '');
  if (res.status === 400 && body.includes('op_already_exists')) return;
  throw new Error(`Friendbot funding failed (${res.status}).`);
}
