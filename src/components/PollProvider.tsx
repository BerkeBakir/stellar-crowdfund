'use client';
import { useEffect, useRef } from 'react';
import { listCampaigns } from '@/lib/factory';
import { getCampaignEvents, fetchLatestLedger } from '@/lib/events';
import { useAppStore } from '@/store';
import { FACTORY_ID } from '@/lib/config';

export default function PollProvider() {
  const setCampaigns = useAppStore((s) => s.setCampaigns);
  const addEvents = useAppStore((s) => s.addEvents);
  const campaigns = useAppStore((s) => s.campaigns);
  const cursor = useRef<number | null>(null);
  const campaignsRef = useRef<string[]>([]);

  useEffect(() => {
    campaignsRef.current = campaigns;
  }, [campaigns]);

  useEffect(() => {
    let active = true;
    async function tick() {
      try {
        const ids = await listCampaigns();
        if (!active) return;
        setCampaigns(ids);
        if (cursor.current === null) {
          const latest = await fetchLatestLedger();
          cursor.current = Math.max(latest - 2000, 1);
        }
        const contracts = [FACTORY_ID, ...ids];
        const { events, latestLedger } = await getCampaignEvents(cursor.current, contracts);
        if (!active) return;
        if (events.length > 0) addEvents(events);
        cursor.current = latestLedger + 1;
      } catch { /* non-fatal */ }
    }
    tick();
    const t = setInterval(tick, 5000);
    return () => { active = false; clearInterval(t); };
  }, [setCampaigns, addEvents]);

  return null;
}
