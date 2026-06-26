import Link from 'next/link';
import type { Summary } from '@/lib/campaign';
import { stroopsToXlm, pct, timeLeft, truncate } from '@/lib/format';

export default function CampaignCard({ id, summary, now }: { id: string; summary: Summary; now: number }) {
  const percent = pct(summary.raised, summary.goal);
  const statusLabel = summary.status === 1 ? 'Claimed' : summary.status === 2 ? 'Refunding' : 'Active';
  return (
    <Link href={`/campaign/${id}`} className="block rounded-lg border p-4 hover:border-white/40">
      <div className="mb-2 flex items-center justify-between text-sm">
        <span className="font-mono opacity-70">{truncate(summary.creator)}</span>
        <span className="opacity-70">{timeLeft(summary.deadline, now)}</span>
      </div>
      <div className="mb-1 text-sm">
        {stroopsToXlm(summary.raised)} / {stroopsToXlm(summary.goal)} XLM
      </div>
      <div className="h-2 w-full overflow-hidden rounded bg-white/10">
        <div className="h-full bg-green-500" style={{ width: `${percent}%` }} />
      </div>
      <div className="mt-1 flex items-center justify-between text-xs opacity-70">
        <span>{percent}%</span>
        <span>{statusLabel}</span>
      </div>
    </Link>
  );
}
