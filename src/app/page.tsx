'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import WalletBar from '@/components/WalletBar';
import PollProvider from '@/components/PollProvider';
import CampaignCard from '@/components/CampaignCard';
import { useAppStore } from '@/store';
import { getSummary, type Summary } from '@/lib/campaign';

export default function Home() {
  const campaigns = useAppStore((s) => s.campaigns);
  const [summaries, setSummaries] = useState<Record<string, Summary>>({});
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 30000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      const entries = await Promise.all(
        campaigns.map(async (id) => { try { return [id, await getSummary(id)] as const; } catch { return null; } })
      );
      if (!active) return;
      const map: Record<string, Summary> = {};
      for (const e of entries) if (e) map[e[0]] = e[1];
      setSummaries(map);
    })();
    return () => { active = false; };
  }, [campaigns]);

  return (
    <main className="mx-auto max-w-3xl p-4 sm:p-6 flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold">Stellar Crowdfund</h1>
        <p className="text-sm opacity-70">Decentralized crowdfunding on Stellar Testnet — factory-deployed campaigns with real XLM.</p>
      </header>
      <PollProvider />
      <WalletBar />
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Campaigns</h2>
        <Link href="/create" className="rounded bg-white px-3 py-1.5 text-sm font-medium text-black">+ New campaign</Link>
      </div>
      {campaigns.length === 0 ? (
        <p className="text-sm opacity-60">No campaigns yet. Create the first one!</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {campaigns.map((id) => summaries[id] && <CampaignCard key={id} id={id} summary={summaries[id]} now={now} />)}
        </div>
      )}
    </main>
  );
}
