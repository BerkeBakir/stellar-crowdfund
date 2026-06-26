'use client';
import { useEffect, useState } from 'react';
import { getScore } from '@/lib/reputation';

export default function ReputationBadge({ creator }: { creator: string }) {
  const [score, setScore] = useState<number | null>(null);
  useEffect(() => {
    let active = true;
    getScore(creator).then((s) => { if (active) setScore(s); }).catch(() => {});
    return () => { active = false; };
  }, [creator]);
  if (score === null) return null;
  return <span className="rounded-full border px-2 py-0.5 text-xs">⭐ {score} successful</span>;
}
