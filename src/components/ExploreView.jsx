import { useCallback, useEffect, useMemo, useState } from 'react';
import ExploreSidebar from './ExploreSidebar';
import ExploreSessionModal from './ExploreSessionModal';
import { getExploreBatch, swapCard, getSessionContent } from '../services/explore';
import { appendLog, loadPrefs, loadSaved, loadSessions, savePrefs, saveSaved, saveSessions, loadFeed, saveFeed, getCachedSession, setCachedSession, clearSessionCache } from '../utils/exploreStorage';
import { generateMissingSummaries } from '../services/learn_simple';

const MINUTES = [3, 5, 10, 15];
const MODES = ['Read', 'Code', 'Quiz'];
const VIBES = ['Chill', 'Focused'];

function useHistorySnippets(conversations) {
  return useMemo(() => {
    const now = Date.now();
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
    const msgs = [];
    for (const c of conversations || []) {
      for (const m of c.messages || []) {
        const t = Date.parse(m.timestamp || '') || now;
        if (t >= sevenDaysAgo) {
          msgs.push({ t, text: m.content || '' });
        }
      }
    }
    msgs.sort((a, b) => b.t - a.t);
    return msgs.slice(0, 200).map((x) => x.text);
  }, [conversations]);
}

const ExploreCard = ({ card, onStart, onDismiss, onSave, variant, isSaved, isCompleted }) => {
  if (card && card.__placeholder) {
    // Invisible placeholder to preserve grid position
    return <div className="h-32 rounded-lg border border-transparent invisible" aria-hidden />;
  }
  const tone = variant === 'review'
    ? {
        chip: 'bg-emerald-50 text-emerald-800 border-emerald-200',
        box: 'border-emerald-200',
        accent: 'border-l-emerald-400',
        bg: 'bg-gradient-to-br from-emerald-50/1 to-white'
      }
    : variant === 'deep_dive'
      ? {
          chip: 'bg-emerald-100 text-emerald-900 border-emerald-300',
          box: 'border-emerald-300',
          accent: 'border-l-emerald-600',
          bg: 'bg-gradient-to-br from-emerald-100/1 to-white'
        }
      : variant === 'adjacent'
        ? {
            chip: 'bg-emerald-50 text-emerald-800 border-emerald-300',
            box: 'border-emerald-300',
            accent: 'border-l-emerald-500',
            bg: 'bg-gradient-to-br from-emerald-50/1 to-white'
          }
        : { chip: 'bg-gray-100 text-gray-800 border-gray-200', box: 'border-gray-200', accent: 'border-l-gray-300', bg: 'bg-white' };
  return (
    <div className={`h-full flex flex-col border ${tone.box} border-l-4 ${tone.accent} rounded-lg p-4 ${tone.bg} shadow-sm overflow-hidden`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[15px] md:text-base font-semibold text-gray-900 leading-snug break-words line-clamp-2">{card.title}</div>
          <div className="text-sm text-gray-600 mt-1 break-words line-clamp-3">{card.why_now}</div>
          <div className="mt-2 flex items-center gap-2">
            <span className="text-[11px] px-1.5 py-0.5 rounded-full border border-emerald-300 text-emerald-800 bg-emerald-50">{card.minutes}m</span>
            <span className="text-[11px] px-1.5 py-0.5 rounded-full border border-emerald-300 text-emerald-800 bg-emerald-50">{card.mode}</span>
          </div>
        </div>
        <div className="text-xs text-gray-500 shrink-0" />
      </div>
      {card.prerequisites && card.prerequisites.length > 0 && (
        <div className="mt-2 text-xs text-gray-500 line-clamp-1">Prereqs: {card.prerequisites.join(', ')}</div>
      )}
      <div className="mt-auto pt-3 flex items-center gap-2">
        {isCompleted ? (
          <button disabled className="px-3 py-1.5 text-sm rounded-md bg-gray-200 text-gray-600 cursor-default">Completed</button>
        ) : (
          <button onClick={onStart} className={`px-3 py-1.5 text-sm rounded-md text-white hover:opacity-90 ${variant==='deep_dive' ? 'bg-emerald-700' : variant==='adjacent' ? 'bg-emerald-500' : 'bg-emerald-600'}`}>Start</button>
        )}
        {onDismiss && (
          <button onClick={onDismiss} className="px-2.5 py-1 text-xs rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50">Dismiss</button>
        )}
        {isSaved ? (
          <button disabled className="px-3 py-1.5 text-sm rounded-md border border-gray-200 text-gray-500 bg-gray-50 cursor-default">Saved</button>
        ) : (
          <button onClick={onSave} className="px-3 py-1.5 text-sm rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50">Save</button>
        )}
      </div>
    </div>
  );
};

const Chip = ({ active, onClick, children }) => (
  <button onClick={onClick} className={`px-2.5 py-1 text-sm rounded-full border ${active ? 'bg-emerald-600 text-white border-emerald-600' : 'border-gray-300 text-gray-700 hover:bg-gray-50'}`}>{children}</button>
);

export default function ExploreView({
  conversations,
  onExitExplore,
}) {
  const snippets = useHistorySnippets(conversations);

  const initialPrefs = loadPrefs();
  const [minutes, setMinutes] = useState(initialPrefs.default_minutes ?? null);
  const [mode, setMode] = useState(initialPrefs.default_mode ?? null);
  const [vibe, setVibe] = useState(initialPrefs.default_vibe ?? null);
  const [intent, setIntent] = useState('');
  const [groups, setGroups] = useState([]); // [{id,label,description,cards[]}]
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('feed'); // feed | saved | sessions
  const [savedList, setSavedList] = useState(() => loadSaved());
  const [sessions, setSessions] = useState(() => loadSessions());
  const [sessionOpen, setSessionOpen] = useState(false);
  const [sessionCard, setSessionCard] = useState(null);
  const [generatingSummaries, setGeneratingSummaries] = useState(false);
  const [summaryStats, setSummaryStats] = useState(null);

  const GROUP_COPY = {
    review: 'Quick refresh of what you already covered — concise, no fluff.',
    deep_dive: 'Build depth on the same theme — introduce a next-step concept.',
    adjacent: 'Widen the map with closely related, high‑relevance topics.',
  };

  const handleGenerateSummaries = useCallback(async () => {
    setGeneratingSummaries(true);
    setSummaryStats(null);
    try {
      const { stats } = await generateMissingSummaries({ 
        conversations, 
        preferredModel: 'gemini-2.5-flash-lite' 
      });
      setSummaryStats(stats);
      // Auto-hide stats after 5 seconds
      setTimeout(() => setSummaryStats(null), 5000);
    } catch (error) {
      console.error('Failed to generate summaries:', error);
      setSummaryStats({ error: error?.message || 'Failed to generate summaries' });
    } finally {
      setGeneratingSummaries(false);
    }
  }, [conversations]);

  const regenerate = useCallback(async () => {
    setLoading(true);
    appendLog({ type: 'feed_shown' });
    const res = await getExploreBatch({ historySnippets: snippets, minutes, mode, vibe, intent, mutedTopics: [], savedIds: savedList.map(s => s.id) });
    // Prefer grouped structure, fallback to a single generic group if needed
    if (Array.isArray(res.groups)) {
      setGroups(res.groups);
    } else if (Array.isArray(res.cards)) {
      setGroups([{ id: 'mixed', label: 'Suggestions', description: '', cards: res.cards }]);
    } else {
      setGroups([]);
    }
    setLoading(false);
    // persist prefs
    savePrefs({ default_minutes: minutes, default_mode: mode, default_vibe: vibe });
    // persist feed snapshot
    const feed = { groups: Array.isArray(res.groups) ? res.groups : (Array.isArray(res.cards) ? [{ id: 'mixed', label: 'Suggestions', description: '', cards: res.cards }] : []), params: { minutes, mode, vibe, intent }, createdAt: Date.now() };
    saveFeed(feed);
  }, [snippets, minutes, mode, vibe, intent, savedList]);

  // Load persisted feed; only generate if none exists
  useEffect(() => {
    const saved = loadFeed();
    if (saved && Array.isArray(saved.groups) && saved.groups.length > 0) {
      setGroups(saved.groups);
    } else {
      regenerate();
    }
    // Do not auto-regenerate on chip change; require explicit Refresh
  }, []);

  const handleStart = async (card) => {
    appendLog({ type: 'card_started', card_id: card.id, topic: card.topic });
    setSessionCard(card);
    setSessionOpen(true);
  };

  const handleDismiss = (card, gIdx, cIdx) => {
    appendLog({ type: 'card_dismissed', card_id: card.id, topic: card.topic });
    setGroups((prev) => {
      const next = prev.map((g, i) => {
        if (i !== gIdx) return g;
        const cards = (g.cards || []).slice();
        // Replace with placeholder to preserve position
        cards[cIdx] = { id: `placeholder-${g.id}-${cIdx}-${Date.now()}`, __placeholder: true };
        return { ...g, cards };
      });
      // Save immediately so board persists
      saveFeed({ groups: next, params: { minutes, mode, vibe, intent }, createdAt: Date.now() });
      return next;
    });
  };

  const handleSave = (card) => {
    appendLog({ type: 'card_saved', card_id: card.id, topic: card.topic });
    setSavedList((prev) => {
      const exists = prev.some((c) => c.id === card.id);
      const next = exists ? prev : [...prev, card];
      saveSaved(next);
      return next;
    });
  };

  const sessionComplete = () => {
    appendLog({ type: 'card_completed', card_id: sessionCard?.id });
    setSessions((prev) => {
      const next = [{ id: `${Date.now()}`, card: sessionCard, completedAt: new Date().toISOString() }, ...prev];
      saveSessions(next);
      return next;
    });
    setSessionOpen(false);
    setSessionCard(null);
  };

  // Prefetch session content for all cards when a fresh board is set
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const all = groups.flatMap(g => g.cards || []);
      for (const card of all) {
        if (!card?.id || card.__placeholder) continue;
        if (cancelled) break;
        if (getCachedSession(card.id)) continue;
        try {
          const res = await getSessionContent({ card });
          if (!cancelled && res?.text) setCachedSession(card.id, res.text);
        } catch {}
      }
    };
    if (groups && groups.length > 0) run();
    return () => { cancelled = true; };
  }, [groups]);

  return (
    <div className="theme-emerald flex h-screen w-full bg-emerald-50">
      {/* Sidebar */}
      <ExploreSidebar
        activeTab={activeTab}
        onChangeTab={setActiveTab}
        onExitExplore={onExitExplore}
        savedCount={savedList.length}
        sessionCount={sessions.length}
      />

      {/* Main */}
      <div className="flex-1 min-w-0 overflow-y-auto px-4 py-4">
          {/* Intent + chips */}
          <div className="max-w-4xl mx-auto">
            <div className="rounded-xl border border-emerald-200 bg-white shadow-sm p-3">
              <div className="flex flex-col gap-2">
                <input
                  value={intent}
                  onChange={(e) => setIntent(e.target.value)}
                  placeholder="I’m in the mood for…"
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
                <div className="flex flex-wrap items-center gap-2">
                  {MINUTES.map((m) => (
                    <Chip key={m} active={m === minutes} onClick={() => setMinutes(prev => prev === m ? null : m)}>{m} min</Chip>
                  ))}
                  <span className="mx-1 text-gray-300">|</span>
                  {MODES.map((md) => (
                    <Chip key={md} active={md === mode} onClick={() => setMode(prev => prev === md ? null : md)}>{md}</Chip>
                  ))}
                  <span className="mx-1 text-gray-300">|</span>
                  {VIBES.map((vb) => (
                    <Chip key={vb} active={vb === vibe} onClick={() => setVibe(prev => prev === vb ? null : vb)}>{vb}</Chip>
                  ))}
                  <div className="ml-auto flex items-center gap-2">
                    <button 
                      onClick={handleGenerateSummaries} 
                      disabled={generatingSummaries}
                      className={`px-3 py-1.5 text-sm rounded-md border border-emerald-600 text-emerald-700 ${generatingSummaries ? 'opacity-60 cursor-not-allowed' : 'hover:bg-emerald-50'}`}
                      title="Generate summaries for Learn mode using Flash Lite model"
                    >
                      {generatingSummaries ? 'Generating...' : 'Generate summaries'}
                    </button>
                    <button onClick={() => { clearSessionCache(); regenerate(); }} className="px-3 py-1.5 text-sm rounded-md bg-emerald-600 text-white hover:bg-emerald-700">Refresh</button>
                  </div>
                </div>
              </div>
            </div>

            {/* Summary generation feedback */}
            {summaryStats && (
              <div className={`mt-3 px-3 py-2 rounded-md border text-sm ${summaryStats.error ? 'border-red-300 bg-red-50 text-red-800' : 'border-emerald-300 bg-emerald-50 text-emerald-800'}`}>
                {summaryStats.error ? (
                  <span>Error: {summaryStats.error}</span>
                ) : (
                  <span>
                    ✓ Summaries: {summaryStats.existing || 0} existing, {summaryStats.generated || 0} generated, {summaryStats.failed || 0} failed
                    {summaryStats.generated === 0 && summaryStats.failed === 0 ? ' (all up to date)' : ''}
                  </span>
                )}
              </div>
            )}

            {/* Content */}
            {activeTab === 'feed' && (
              <div className="mt-4">
                <div className="text-sm text-emerald-700 mb-2">{loading ? 'Generating feed…' : 'Your picks'}</div>
                {loading ? (
                  <div className="space-y-4">
                    {['Review','Deep Dive','Adjacent'].map((label, gi) => (
                      <div key={gi} className="space-y-2">
                        <div className="flex items-center gap-2">
                          <div className="text-gray-800 font-semibold">{label}</div>
                          <div className="text-xs text-gray-500">Generating…</div>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                          {Array.from({ length: 3 }).map((_, i) => (
                            <div key={i} className="h-32 border border-emerald-100 rounded-lg bg-white animate-pulse"/>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="space-y-4">
                    {groups.map((g, gi) => {
                      const sectionTone = g.id === 'review'
                        ? 'bg-emerald-50/10 border-emerald-200'
                        : g.id === 'deep_dive'
                          ? 'bg-emerald-50/15 border-emerald-300'
                          : 'bg-emerald-50/5 border-emerald-300';
                      return (
                      <div key={g.id} className={`space-y-2 rounded-xl border ${sectionTone} p-3`}>
                        <div className="flex items-baseline justify-between">
                          <div>
                            <div className="text-gray-800 font-semibold">{g.label}</div>
                            <div className="text-xs text-gray-500">
                              {GROUP_COPY[g.id] || g.description}
                            </div>
                          </div>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 items-stretch">
                          {g.cards.map((card, ci) => {
                            const isSaved = savedList.some((s) => s.id === card?.id);
                            const isCompleted = sessions.some((s) => s.card?.id === card?.id);
                            return (
                            <ExploreCard
                              key={card.id}
                              card={card}
                              badge={g.label}
                              variant={g.id}
                              onStart={() => handleStart(card)}
                              onDismiss={() => handleDismiss(card, gi, ci)}
                              onSave={() => handleSave(card)}
                              isSaved={isSaved}
                              isCompleted={isCompleted}
                            />
                            );
                          })}
                        </div>
                      </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {activeTab === 'saved' && (
              <div className="mt-4">
                {savedList.length === 0 ? (
                  <div className="text-gray-600">No saved items yet.</div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-stretch">
                    {savedList.map((card, idx) => {
                      const isCompleted = sessions.some((s) => s.card?.id === card?.id);
                      return (
                        <ExploreCard
                          key={card.id}
                          card={card}
                          onStart={() => handleStart(card)}
                          onSave={() => handleSave(card)}
                          isSaved={true}
                          isCompleted={isCompleted}
                        />
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {activeTab === 'sessions' && (
              <div className="mt-4 space-y-2">
                {sessions.length === 0 ? (
                  <div className="text-gray-600">No sessions yet.</div>
                ) : (
                  sessions.map((s) => (
                    <div key={s.id} className="border border-emerald-200 rounded-md p-3 bg-white flex items-center justify-between">
                      <div className="truncate">
                        <div className="font-medium text-gray-900 truncate">{s.card?.title}</div>
                        <div className="text-xs text-gray-500">Completed {new Date(s.completedAt).toLocaleString()}</div>
                      </div>
                      <div className="text-xs text-gray-500">{s.card?.minutes} min • {s.card?.mode}</div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
      </div>

      {/* Session Modal */}
      <ExploreSessionModal
        open={sessionOpen}
        card={sessionCard}
        onClose={() => { setSessionOpen(false); setSessionCard(null); }}
        onComplete={sessionComplete}
      />
    </div>
  );
}
