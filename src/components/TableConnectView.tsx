import React, { useEffect, useState } from 'react';
import { Compass, MessageSquare, Radio, ShieldCheck, Users } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { CommunityVibe, Icebreaker } from '../types';

const TABLE_ZONES = [
  'Window Lounge · Table 3',
  'Window Lounge · Table 4',
  'Communal High-Top · Table 6',
  'Roastery Alcove · Table 8',
  'Quiet Reading Bench · Table 11',
];

const PRESET_TAGS = [
  {
    tag: 'Full-stack developer looking for UX feedback',
    desc: 'Prototyping a real-time developer dashboard and would love a quick 5-minute critique from a designer or PM.',
    open: true,
  },
  {
    tag: 'Pre-seed founder brainstorming AI workflows',
    desc: 'Mapping out B2B agent evaluation loops over a cold brew. Happy to trade notes with engineers or founders.',
    open: true,
  },
  {
    tag: 'Quiet reading — do not disturb',
    desc: 'Deep focus session finishing a monograph on architectural acoustics. Checking in silently.',
    open: false,
  },
];

export const TableConnectView: React.FC = () => {
  const { user, signIn, authFetch } = useAuth();
  const [tableZone, setTableZone] = useState(TABLE_ZONES[0]);
  const [focusTag, setFocusTag] = useState(PRESET_TAGS[0].tag);
  const [focusDescription, setFocusDescription] = useState(PRESET_TAGS[0].desc);
  const [openToConnect, setOpenToConnect] = useState(true);

  const [myVibe, setMyVibe] = useState<CommunityVibe | null>(null);
  const [matches, setMatches] = useState<CommunityVibe[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [icebreakerByPeer, setIcebreakerByPeer] = useState<Record<string, Icebreaker>>({});
  const [loadingIcebreakerId, setLoadingIcebreakerId] = useState<string | null>(null);

  const fetchMatches = async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const res = await authFetch('/api/table-connect/matches');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load table matches');
      setMyVibe(data.myVibe || null);
      setMatches(data.matches || []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to fetch nearby focus tags.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user) {
      fetchMatches();
    }
  }, [user]);

  const handlePublishVibe = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      await signIn();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await authFetch('/api/table-connect/opt-in', {
        method: 'POST',
        body: JSON.stringify({
          tableZone,
          focusTag,
          focusDescription,
          openToConnect,
          displayName: user.displayName || user.email?.split('@')[0] || 'Café Patron',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not publish focus tag');
      setMyVibe(data.myVibe);
      setMatches(data.matches || []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to save Table Connect tag.');
    } finally {
      setSaving(false);
    }
  };

  const handleGenerateIcebreaker = async (peer: CommunityVibe) => {
    if (!user) return;
    setLoadingIcebreakerId(peer.id);
    setError(null);
    try {
      const res = await authFetch('/api/table-connect/icebreaker', {
        method: 'POST',
        body: JSON.stringify({
          peerName: peer.displayName,
          peerZone: peer.tableZone,
          peerFocusTag: peer.focusTag,
          peerFocusDescription: peer.focusDescription,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not craft icebreaker');
      setIcebreakerByPeer((prev) => ({ ...prev, [peer.id]: data.icebreaker }));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to craft icebreaker.');
    } finally {
      setLoadingIcebreakerId(null);
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-2 border-b border-neutral-200 pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-medium text-neutral-500">
            Pillar C · Privacy-First Co-Working &amp; Serendipity Engine
          </p>
          <h1 className="mt-1 font-display text-3xl font-semibold text-[#14171A]">
            Table Connect
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-neutral-600">
            Tap your table’s NFC disc to set an ephemeral 2-hour focus status. Vector embeddings match latent creative and technical overlap without exposing personal contact details.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-neutral-500 shrink-0">
          <ShieldCheck className="h-4 w-4 text-[#1B4332]" />
          <span>Auto-expiring 2-hour TTL</span>
        </div>
      </div>

      {!user && (
        <div className="flex flex-col items-start justify-between gap-4 rounded-xl border border-neutral-200 bg-white p-6 sm:flex-row sm:items-center">
          <div>
            <p className="text-sm font-semibold text-[#14171A]">
              Sign in to activate your Table NFC session
            </p>
            <p className="mt-1 text-xs text-neutral-600">
              Your focus tag is embedded into a 768-dimension semantic vector and automatically expires after 2 hours.
            </p>
          </div>
          <button
            type="button"
            onClick={signIn}
            className="rounded-lg bg-[#1B4332] px-4 py-2 text-xs font-medium text-white hover:bg-[#143326] whitespace-nowrap shrink-0"
          >
            Sign In with Google
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
        {/* Left: NFC Focus Tag Opt-in Composer */}
        <form
          onSubmit={handlePublishVibe}
          className="rounded-xl border border-neutral-200 bg-white p-6 space-y-5 lg:col-span-5"
        >
          <div className="flex items-center justify-between border-b border-neutral-100 pb-4">
            <h2 className="font-display text-xl font-semibold text-[#14171A]">
              Table NFC Check-In
            </h2>
            <Radio className="h-4 w-4 text-[#1B4332]" />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="nfc-zone" className="block text-xs font-medium text-neutral-600">
              Micro-Zone / Table Disc
            </label>
            <select
              id="nfc-zone"
              value={tableZone}
              onChange={(e) => setTableZone(e.target.value)}
              className="w-full rounded-lg border border-neutral-300 bg-[#F8F9FA] px-3 py-2 text-sm text-[#14171A] focus:border-[#1B4332] focus:bg-white focus:outline-none"
            >
              {TABLE_ZONES.map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <span className="block text-xs font-medium text-neutral-600">Quick Presets</span>
            <div className="flex flex-col gap-1.5">
              {PRESET_TAGS.map((preset) => (
                <button
                  key={preset.tag}
                  type="button"
                  onClick={() => {
                    setFocusTag(preset.tag);
                    setFocusDescription(preset.desc);
                    setOpenToConnect(preset.open);
                  }}
                  className="rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-left text-xs text-neutral-700 hover:border-neutral-300 hover:text-[#14171A] transition-colors"
                >
                  {preset.tag}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="focus-tag" className="block text-xs font-medium text-neutral-600">
              2-Hour Focus Headline
            </label>
            <input
              id="focus-tag"
              type="text"
              required
              value={focusTag}
              onChange={(e) => setFocusTag(e.target.value)}
              className="w-full rounded-lg border border-neutral-300 bg-[#F8F9FA] px-3 py-2 text-sm text-[#14171A] focus:border-[#1B4332] focus:bg-white focus:outline-none"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="focus-desc" className="block text-xs font-medium text-neutral-600">
              What are you working on?
            </label>
            <textarea
              id="focus-desc"
              rows={3}
              required
              value={focusDescription}
              onChange={(e) => setFocusDescription(e.target.value)}
              className="w-full rounded-lg border border-neutral-300 bg-[#F8F9FA] px-3 py-2 text-sm text-[#14171A] focus:border-[#1B4332] focus:bg-white focus:outline-none"
            />
          </div>

          <label className="flex items-center justify-between gap-3 rounded-lg border border-neutral-200 bg-[#F8F9FA] px-3.5 py-2.5 cursor-pointer">
            <span className="text-xs font-medium text-[#14171A]">
              Open to serendipitous introductions
            </span>
            <input
              type="checkbox"
              checked={openToConnect}
              onChange={(e) => setOpenToConnect(e.target.checked)}
              className="h-4 w-4 accent-[#1B4332]"
            />
          </label>

          {error && <p className="text-xs text-[#DC2626]">{error}</p>}

          <button
            type="submit"
            disabled={saving}
            className="w-full rounded-lg bg-[#1B4332] py-2.5 text-sm font-medium text-white hover:bg-[#143326] disabled:opacity-60 transition-colors"
          >
            {saving ? 'Embedding & Matching Patrons...' : 'Publish 2-Hour Table Tag'}
          </button>

          {myVibe && (
            <div className="border-t border-neutral-100 pt-4 text-xs text-neutral-600">
              <p className="font-semibold text-[#14171A]">
                Active at {myVibe.tableZone}
              </p>
              <p className="mt-0.5">
                {myVibe.focusTag} · {myVibe.openToConnect ? 'Open to Connect' : 'Quiet Mode'}
              </p>
              <p className="mt-0.5 font-mono text-[11px] text-neutral-500">
                Expires {new Date(myVibe.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>
          )}
        </form>

        {/* Right: Semantic Vector Matches & Contextual Icebreakers */}
        <div className="rounded-xl border border-neutral-200 bg-white p-6 lg:col-span-7 flex flex-col">
          <div className="flex items-center justify-between border-b border-neutral-100 pb-4">
            <div>
              <h2 className="font-display text-xl font-semibold text-[#14171A]">
                Active Patrons Ranked by Vector Overlap
              </h2>
              <p className="mt-0.5 text-xs text-neutral-500">
                Cosine similarity computed over active non-expired table embeddings
              </p>
            </div>
            <button
              type="button"
              onClick={fetchMatches}
              disabled={!user || loading}
              className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-[#14171A] hover:bg-neutral-50 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              Refresh Matches
            </button>
          </div>

          <div className="mt-5 flex-1 space-y-4">
            {loading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((n) => (
                  <div key={n} className="h-24 animate-pulse rounded-lg bg-neutral-100" />
                ))}
              </div>
            ) : matches.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-14 text-center">
                <Users className="h-8 w-8 text-neutral-300" />
                <p className="mt-3 text-sm font-semibold text-[#14171A]">
                  No other patrons checked in yet
                </p>
                <p className="mt-1 max-w-sm text-xs leading-relaxed text-neutral-500">
                  Publish your 2-hour table focus tag on the left. As other signed-in guests tap in across the café, semantic cosine matches will appear here automatically.
                </p>
              </div>
            ) : (
              matches.map((peer) => {
                const similarityPct =
                  peer.similarity != null ? Math.max(0, Math.min(100, Math.round(peer.similarity * 100))) : null;
                const icebreaker = icebreakerByPeer[peer.id];

                return (
                  <div
                    key={peer.id}
                    className="rounded-lg border border-neutral-200 bg-[#F8F9FA] p-4 space-y-3"
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <div>
                        <h3 className="text-sm font-semibold text-[#14171A]">
                          {peer.displayName}
                        </h3>
                        <p className="text-xs text-neutral-500">
                          {peer.tableZone} · {peer.openToConnect ? 'Open to connect' : 'Quiet mode'}
                        </p>
                      </div>
                      {similarityPct !== null && (
                        <span className="font-mono text-xs font-semibold tabular-nums text-[#1B4332]">
                          {similarityPct}% semantic overlap
                        </span>
                      )}
                    </div>

                    <div>
                      <p className="text-sm font-medium text-[#14171A]">{peer.focusTag}</p>
                      <p className="mt-1 text-xs leading-relaxed text-neutral-600">
                        {peer.focusDescription}
                      </p>
                    </div>

                    {peer.openToConnect && myVibe && (
                      <div className="pt-1">
                        {icebreaker ? (
                          <div className="rounded-md border border-neutral-200 bg-white p-3.5 space-y-2">
                            <p className="text-xs font-medium text-[#1B4332] flex items-center gap-1.5">
                              <Compass className="h-3.5 w-3.5" />
                              Shared Ground: {icebreaker.sharedGround}
                            </p>
                            <p className="text-sm text-[#14171A]">
                              “{icebreaker.icebreakerPrompt}”
                            </p>
                            <p className="text-xs text-neutral-500">
                              Suggestion: {icebreaker.suggestedTableAction}
                            </p>
                          </div>
                        ) : (
                          <button
                            type="button"
                            disabled={loadingIcebreakerId === peer.id}
                            onClick={() => handleGenerateIcebreaker(peer)}
                            className="inline-flex items-center gap-1.5 rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-[#14171A] hover:border-[#1B4332] hover:text-[#1B4332] disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
                          >
                            <MessageSquare className="h-3.5 w-3.5" />
                            {loadingIcebreakerId === peer.id
                              ? 'Crafting icebreaker...'
                              : 'Craft Contextual Icebreaker'}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
