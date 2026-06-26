const STROOPS = 10_000_000n;

export function truncate(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 5)}…${addr.slice(-4)}`;
}

export function stroopsToXlm(stroops: bigint): string {
  const neg = stroops < 0n;
  const abs = neg ? -stroops : stroops;
  const whole = abs / STROOPS;
  const frac = abs % STROOPS;
  let out = whole.toString();
  if (frac > 0n) {
    const fracStr = frac.toString().padStart(7, '0').replace(/0+$/, '');
    out += `.${fracStr}`;
  }
  return neg ? `-${out}` : out;
}

export function xlmToStroops(xlm: string): bigint {
  const t = xlm.trim();
  if (!/^\d+(\.\d{1,7})?$/.test(t)) throw new Error('Invalid XLM amount');
  const [whole, frac = ''] = t.split('.');
  const fracPadded = frac.padEnd(7, '0');
  return BigInt(whole) * STROOPS + BigInt(fracPadded);
}

export function pct(raised: bigint, goal: bigint): number {
  if (goal <= 0n) return 0;
  const p = Number((raised * 100n) / goal);
  return Math.max(0, Math.min(100, p));
}

export function timeLeft(deadline: number, now: number): string {
  const s = deadline - now;
  if (s <= 0) return 'ended';
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  return `${h}h ${m}m`;
}
